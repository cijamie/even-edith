import type { AudioSpeakerRole } from '@evenrealities/even_hub_sdk'
import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import { ApiError } from '../net/http'
import { isNoise, transcribe, GROQ_FREE } from '../net/groq'
import { speakerLabel, type Speaker } from '../data/transcript'
import { Segmenter, type Segment } from '../voice/segmenter'
import type { Host, Mode } from './mode'

// Stay under Groq's free requests-per-minute with a little headroom.
const MIN_GAP_MS = Math.ceil(60_000 / (GROQ_FREE.requestsPerMinute - 2))

/**
 * Live subtitles of nearby speech; with `translate`, any language comes out in English.
 * Swipe up to rewind through what was said, down to return to live.
 * Everything heard also goes to the shared transcript for "what did they just say?".
 */
export class CaptionsMode implements Mode {
  readonly name = 'captions'
  private text = ''
  private lastSpeaker: Speaker = 'unknown'
  private queue: Segment[] = []
  private busy = false
  private lastRequest = 0
  private segmenter: Segmenter
  private status = ''
  private pages: string[] = ['']
  /** Page shown when rewound; null follows the live end. */
  private rewind: number | null = null

  constructor(
    private host: Host,
    private translate: boolean,
  ) {
    this.segmenter = new Segmenter(host.bridge, { minSeconds: 2.5, maxSeconds: 7 }, (s) => this.enqueue(s))
  }

  async enter() {
    const { display } = this.host
    await Promise.all([
      display.set(ID.header, this.translate ? '● TRANSLATING · EN' : '● LIVE CAPTIONS'),
      display.set(ID.body, 'Listening...'),
      this.footer(),
    ])
    if (!(await this.host.settings.get('groq'))) return this.host.finish('Captions need a Groq key. Add one in the phone app.')
    await this.segmenter.start()
  }

  async exit() {
    await this.segmenter.stop()
    this.queue = []
  }

  audio(pcm: Uint8Array, role?: AudioSpeakerRole) {
    this.segmenter.push(pcm, role)
  }

  swipe(dir: 1 | -1) {
    const last = this.pages.length - 1
    const at = (this.rewind ?? last) + dir
    if (at < 0) return
    this.rewind = at >= last ? null : at
    void this.host.display.set(ID.body, this.pages[this.rewind ?? last])
    void this.footer()
  }

  private enqueue(s: Segment) {
    // If Groq falls behind, drop the oldest clip rather than lag further and further.
    this.queue = [...this.queue, s].slice(-3)
    void this.process()
  }

  private async process() {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length && this.segmenter.active) {
        const wait = this.lastRequest + MIN_GAP_MS - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        const seg = this.queue.shift()!
        this.lastRequest = Date.now()
        try {
          const key = await this.host.settings.get('groq')
          const said = await transcribe(seg.wav, key, { translate: this.translate })
          await this.host.usage.add(seg.seconds)
          this.status = ''
          if (!isNoise(said)) this.append(said, seg.speaker)
        } catch (err) {
          this.status = err instanceof ApiError && err.kind === 'rate' ? 'GROQ BUSY · WAITING' : 'GROQ ERROR'
          if (err instanceof ApiError && err.kind === 'rate') this.lastRequest = Date.now() + 10_000
        }
        void this.footer()
      }
    } finally {
      this.busy = false
    }
  }

  private append(said: string, speaker: Speaker) {
    this.host.transcript.add(said, speaker)
    // A new line with a label whenever the (known) speaker changes.
    const label = speakerLabel(speaker)
    const turn = label && speaker !== this.lastSpeaker
    if (speaker !== 'unknown') this.lastSpeaker = speaker
    this.text = (turn ? `${this.text}\n${label.toUpperCase()}: ${said}` : `${this.text} ${said}`).trim().slice(-6000)
    this.pages = paginate(this.text)
    // Show the latest page so the newest words are always visible, unless rewound.
    if (this.rewind === null) void this.host.display.set(ID.body, this.pages[this.pages.length - 1])
    else void this.footer()
  }

  private footer() {
    const quota = this.host.usage.fraction
    const warn = quota > 0.8 ? ` · FREE QUOTA ${Math.round(quota * 100)}%` : ''
    const where = this.rewind === null ? 'PRESS · STOP' : `REWIND ${this.rewind + 1}/${this.pages.length} · SWIPE DOWN · LIVE`
    return this.host.display.set(ID.footer, (this.status || where) + warn)
  }
}
