import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import { ApiError } from '../net/http'
import { isNoise, transcribe, GROQ_FREE } from '../net/groq'
import { Segmenter, type Segment } from '../voice/segmenter'
import type { Host, Mode } from './mode'

// Stay under Groq's free requests-per-minute with a little headroom.
const MIN_GAP_MS = Math.ceil(60_000 / (GROQ_FREE.requestsPerMinute - 2))

/** Live subtitles of nearby speech; with `translate`, any language comes out in English. */
export class CaptionsMode implements Mode {
  readonly name = 'captions'
  private text = ''
  private queue: Segment[] = []
  private busy = false
  private lastRequest = 0
  private segmenter: Segmenter
  private status = ''

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

  audio(pcm: Uint8Array) {
    this.segmenter.push(pcm)
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
          if (!isNoise(said)) this.append(said)
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

  private append(said: string) {
    this.text = `${this.text} ${said}`.trim().slice(-4000)
    // Show the latest page so the newest words are always visible.
    const pages = paginate(this.text)
    void this.host.display.set(ID.body, pages[pages.length - 1])
  }

  private footer() {
    const quota = this.host.usage.fraction
    const warn = quota > 0.8 ? ` · FREE QUOTA ${Math.round(quota * 100)}%` : ''
    return this.host.display.set(ID.footer, (this.status || 'PRESS · STOP') + warn)
  }
}
