import type { AudioSpeakerRole } from '@evenrealities/even_hub_sdk'
import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import { isNoise, transcribe, GROQ_FREE } from '../net/groq'
import { Segmenter, type Segment } from '../voice/segmenter'
import { followScript, wordsOf } from '../voice/follow'
import type { Host, Mode } from './mode'

/** Shows the script saved on the phone page, one screen at a time. */
export class TeleprompterMode implements Mode {
  readonly name: string = 'teleprompter'
  protected pages: string[] = []
  protected page = 0

  constructor(protected host: Host) {}

  async enter() {
    const script = (await this.host.settings.teleprompter()).trim()
    if (!script) return this.host.finish('No script loaded. Paste one into the teleprompter card in the phone app.')
    this.pages = paginate(script)
    await this.host.display.set(ID.header, 'TELEPROMPTER')
    await this.show(0)
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const next = this.page + dir
    if (next >= 0 && next < this.pages.length) void this.show(next)
  }

  /** Lets the phone remote jump to a page. */
  async show(n: number) {
    this.page = n
    await Promise.all([
      this.host.display.set(ID.body, this.pages[n]),
      this.host.display.set(ID.footer, this.footer(n)),
    ])
  }

  protected footer(n: number) {
    return `${n + 1}/${this.pages.length} · SWIPE · PRESS TO CLOSE`
  }
}

// Stay under Groq's free requests-per-minute with some headroom.
const MIN_GAP_MS = Math.ceil(60_000 / (GROQ_FREE.requestsPerMinute - 3))

/** Teleprompter that listens and turns the page as you read, instead of on swipes. */
export class FollowTeleprompterMode extends TeleprompterMode {
  readonly name = 'teleprompter'
  private words: string[] = []
  /** Index of the first word of each page. */
  private starts: number[] = []
  private cursor = 0
  private segmenter: Segmenter
  private queue: Segment[] = []
  private busy = false
  private lastRequest = 0

  constructor(host: Host) {
    super(host)
    this.segmenter = new Segmenter(host.bridge, { minSeconds: 2, maxSeconds: 5 }, (s) => {
      this.queue = [...this.queue, s].slice(-2)
      void this.process()
    })
  }

  async enter() {
    if (!(await this.host.settings.get('groq'))) return this.host.finish('Voice scrolling needs a Groq key. Add one in the phone app.')
    await super.enter()
    if (!this.pages.length) return
    let n = 0
    this.starts = this.pages.map((p) => {
      const at = n
      n += wordsOf(p).length
      return at
    })
    this.words = this.pages.flatMap(wordsOf)
    await this.host.display.set(ID.header, '● TELEPROMPTER · FOLLOWING')
    await this.segmenter.start()
  }

  async exit() {
    if (this.segmenter.active) await this.segmenter.stop()
    this.queue = []
  }

  audio(pcm: Uint8Array, role?: AudioSpeakerRole) {
    this.segmenter.push(pcm, role)
  }

  swipe(dir: 1 | -1) {
    // Manual correction still works; listening carries on from the new page.
    super.swipe(dir)
    this.cursor = this.starts[this.page] ?? this.cursor
  }

  protected footer(n: number) {
    return `${n + 1}/${this.pages.length} · FOLLOWING YOUR VOICE`
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
          // The upcoming script as a prompt steers Whisper towards its wording.
          const prompt = this.words.slice(this.cursor, this.cursor + 30).join(' ')
          const said = await transcribe(seg.wav, await this.host.settings.get('groq'), { prompt })
          await this.host.usage.add(seg.seconds)
          if (isNoise(said)) continue
          this.cursor = followScript(this.words, this.cursor, wordsOf(said))
          // Turn the page once the speaker is most of the way through it.
          let page = this.page
          while (page < this.pages.length - 1 && this.cursor >= this.starts[page + 1] - 6) page++
          if (page !== this.page) await this.show(page)
        } catch (err) {
          console.warn('[teleprompter] transcription failed', err)
        }
      }
    } finally {
      this.busy = false
    }
  }
}
