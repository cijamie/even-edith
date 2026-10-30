import { AudioInputSource, AudioSpeakerRole, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { rms, toWav } from './recorder'
import type { Speaker } from '../data/transcript'

const RATE = 16000
const QUIET = 0.01 // RMS below this counts as a pause
const SILENT_PEAK = 0.008 // segments never louder than this are dropped
const TURN_CHUNKS = 6 // ~0.6 s of the other speaker before a clip is cut at the turn

export type Segment = { wav: Blob; seconds: number; speaker: Speaker }

type Chunk = { pcm: Uint8Array; role: Speaker }

const roleOf = (r?: AudioSpeakerRole): Speaker => (r === AudioSpeakerRole.Self ? 'self' : r === AudioSpeakerRole.Other ? 'other' : 'unknown')

/**
 * Continuous listening that cuts the mic stream into clips at natural pauses,
 * for live captions and meeting recording. A clip is flushed once it's at
 * least `minSeconds` long and the speaker pauses, or at `maxSeconds` regardless.
 * When the Even app tags who is talking (you or someone else), clips are also
 * cut where the speaker changes, so each one can be labelled.
 * Silent clips are dropped so they don't burn Groq quota.
 */
export class Segmenter {
  private chunks: Chunk[] = []
  private bytes = 0
  active = false

  constructor(
    private bridge: EvenAppBridge,
    private opts: { minSeconds: number; maxSeconds: number },
    private onSegment: (s: Segment) => void,
    private onLevel: (level: number) => void = () => {},
  ) {}

  async start() {
    this.reset()
    this.active = true
    await this.bridge.audioControl(true, AudioInputSource.Glasses)
  }

  async stop() {
    this.active = false
    await this.bridge.audioControl(false)
    this.flush(this.chunks)
    this.reset()
  }

  push(pcm: Uint8Array, speakerRole?: AudioSpeakerRole) {
    if (!this.active) return
    this.chunks.push({ pcm, role: roleOf(speakerRole) })
    this.bytes += pcm.byteLength
    const level = rms(pcm)
    this.onLevel(Math.min(1, Math.sqrt(level * 5)))
    const seconds = this.bytes / (RATE * 2)

    const turn = this.turnAt()
    if (turn > 0) {
      const tail = this.chunks.slice(turn)
      this.flush(this.chunks.slice(0, turn))
      this.reset()
      for (const c of tail) {
        this.chunks.push(c)
        this.bytes += c.pcm.byteLength
      }
      return
    }
    if ((seconds >= this.opts.minSeconds && level < QUIET) || seconds >= this.opts.maxSeconds) {
      this.flush(this.chunks)
      this.reset()
    }
  }

  /** Index where a sustained change of known speaker began, after at least a second of the previous one; else -1. */
  private turnAt() {
    const n = this.chunks.length
    if (n < TURN_CHUNKS + 10) return -1
    const recent = this.chunks.slice(-TURN_CHUNKS).map((c) => c.role)
    const role = recent[0]
    if (role === 'unknown' || recent.some((r) => r !== role)) return -1
    const before = speakerOf(this.chunks.slice(0, n - TURN_CHUNKS))
    return before === 'unknown' || before === role ? -1 : n - TURN_CHUNKS
  }

  private flush(chunks: Chunk[]) {
    const bytes = chunks.reduce((n, c) => n + c.pcm.byteLength, 0)
    const seconds = bytes / (RATE * 2)
    const peak = Math.max(0, ...chunks.map((c) => rms(c.pcm)))
    if (seconds >= 0.5 && peak >= SILENT_PEAK) {
      const pcm = new Uint8Array(bytes)
      let offset = 0
      for (const c of chunks) {
        pcm.set(c.pcm, offset)
        offset += c.pcm.byteLength
      }
      this.onSegment({ wav: toWav(pcm), seconds, speaker: speakerOf(chunks) })
    }
  }

  private reset() {
    this.chunks = []
    this.bytes = 0
  }
}

/** Majority of the frames the app could classify. */
function speakerOf(chunks: Chunk[]): Speaker {
  let self = 0
  let other = 0
  for (const c of chunks) {
    if (c.role === 'self') self++
    else if (c.role === 'other') other++
  }
  return self > other ? 'self' : other > self ? 'other' : 'unknown'
}
