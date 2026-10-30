import { AudioInputSource, AudioSpeakerRole, type AudioEvent, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { rms, toWav } from './recorder'

const RATE = 16000
const CHUNK_MS = 100
const PRE_ROLL = 3 // chunks kept from before speech starts, so "hey" isn't clipped
const END_SILENCE_MS = 700
const MIN_SECONDS = 0.5
const MAX_SECONDS = 9

export type Utterance = { wav: Blob; seconds: number }

/**
 * Always-on listening for "Hey EDITH". There's no on-device keyword spotter,
 * so this does the cheap part locally: it waits for a burst of speech, cuts it
 * at the pause, and hands it over for transcription. Bursts the Even app marks
 * as someone else talking are dropped, so only the wearer's speech is checked.
 */
export class WakeListener {
  active = false
  private pre: Uint8Array[] = []
  private chunks: Uint8Array[] = []
  private speaking = false
  private quietMs = 0
  private bytes = 0
  private floor = 0.006
  private self = 0
  private other = 0

  constructor(
    private bridge: EvenAppBridge,
    private onUtterance: (u: Utterance) => void,
  ) {}

  async start() {
    this.active = true
    this.reset()
    await this.bridge.audioControl(true, AudioInputSource.Glasses)
  }

  /** `releaseMic` false when handing the mic straight to something else. */
  async stop(releaseMic = true) {
    this.active = false
    this.reset()
    if (releaseMic) await this.bridge.audioControl(false)
  }

  push(event: AudioEvent) {
    if (!this.active) return
    const pcm = event.audioPcm
    const level = rms(pcm)
    // Onset needs to clear the room's own noise, which is tracked while nobody speaks.
    const onset = Math.max(0.018, this.floor * 3)

    if (!this.speaking) {
      this.floor = this.floor * 0.95 + Math.min(level, 0.05) * 0.05
      this.pre = [...this.pre, pcm].slice(-PRE_ROLL)
      if (level < onset) return
      this.speaking = true
      this.chunks = [...this.pre]
      this.bytes = this.chunks.reduce((n, c) => n + c.byteLength, 0)
      this.pre = []
    } else {
      this.chunks.push(pcm)
      this.bytes += pcm.byteLength
    }

    if (event.speakerRole === AudioSpeakerRole.Self) this.self++
    else if (event.speakerRole === AudioSpeakerRole.Other) this.other++
    this.quietMs = level < onset * 0.6 ? this.quietMs + CHUNK_MS : 0

    const seconds = this.bytes / (RATE * 2)
    if (this.quietMs >= END_SILENCE_MS || seconds >= MAX_SECONDS) this.flush(seconds)
  }

  private flush(seconds: number) {
    const someoneElse = this.other > 0 && this.self === 0
    if (seconds >= MIN_SECONDS && !someoneElse) {
      const pcm = new Uint8Array(this.bytes)
      let offset = 0
      for (const c of this.chunks) {
        pcm.set(c, offset)
        offset += c.byteLength
      }
      this.onUtterance({ wav: toWav(pcm), seconds })
    }
    this.reset()
  }

  private reset() {
    this.chunks = []
    this.bytes = 0
    this.speaking = false
    this.quietMs = 0
    this.self = 0
    this.other = 0
  }
}

const WAKE =
  /^(?:(?:hey|hi|hay|ok|okay|a|yo)[\s,]+)?(?:edith|edit|eadie|edie|eddie|ed ith|edith's|aditi|friday|jarvis|jervis|travis)\b[\s,.!?]*(.*)$/i
// Without "hey", only the full names count: plain "edit ..." is too common in speech.
const BARE = /^(?:edith|friday|jarvis)\b/i

/** If the transcript starts with the wake phrase, returns what followed it ('' if nothing). */
export function matchWake(transcript: string): string | null {
  const t = transcript.trim().replace(/^[^\p{L}]+/u, '')
  const m = t.match(WAKE)
  if (!m) return null
  const greeted = /^(?:hey|hi|hay|ok|okay|a|yo)\b/i.test(t)
  if (!greeted && !BARE.test(t)) return null
  return m[1].trim()
}
