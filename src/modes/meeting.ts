import { ID } from '../hud/layout'
import { isNoise, transcribe } from '../net/groq'
import { clock, countdown } from '../util/time'
import { Segmenter, type Segment } from '../voice/segmenter'
import type { Host, Mode } from './mode'

const MAX_MINUTES = 60

const SUMMARY_PROMPT =
  'You summarise meeting transcripts for display on smart glasses. Plain text only, no markdown or bullets. ' +
  'Start with a two or three sentence summary. Then write "Actions:" followed by each action item as a short ' +
  'sentence on its own line, naming the owner if mentioned. If there are none, write "Actions: none." Be concise.'

/** Records a conversation in ~30 s clips, transcribes as it goes, and summarises into a note on stop. */
export class MeetingMode implements Mode {
  readonly name = 'meeting'
  private transcript: string[] = []
  private queue: Segment[] = []
  private busy = false
  private started = Date.now()
  private stopping = false
  private segmenter: Segmenter

  constructor(private host: Host) {
    this.segmenter = new Segmenter(host.bridge, { minSeconds: 20, maxSeconds: 45 }, (s) => {
      this.queue.push(s)
      void this.process()
    })
  }

  async enter() {
    if (!(await this.host.settings.get('groq'))) return this.host.finish('Meeting mode needs a Groq key. Add one in the phone app.')
    this.started = Date.now()
    await Promise.all([
      this.host.display.set(ID.header, '● REC 0:00'),
      this.host.display.set(ID.body, 'Recording. Press to stop and summarise.'),
      this.host.display.set(ID.footer, 'PRESS · STOP'),
    ])
    await this.segmenter.start()
  }

  async exit() {
    if (this.segmenter.active) await this.segmenter.stop()
  }

  audio(pcm: Uint8Array) {
    this.segmenter.push(pcm)
  }

  tick() {
    if (this.stopping) return
    const elapsed = (Date.now() - this.started) / 1000
    void this.host.display.set(ID.header, `● REC ${countdown(elapsed)}`)
    if (elapsed > MAX_MINUTES * 60) this.press()
  }

  press() {
    if (!this.stopping) void this.stop()
    return true
  }

  private async stop() {
    this.stopping = true
    void this.host.display.set(ID.header, 'SUMMARISING')
    void this.host.display.set(ID.footer, 'ONE MOMENT')
    await this.segmenter.stop() // flushes the last clip
    while (this.busy || this.queue.length) await new Promise((r) => setTimeout(r, 200))

    const text = this.transcript.join(' ').trim()
    if (!text) return this.host.finish('I heard nothing worth summarising.')
    try {
      const summary = await this.host.brain.complete(SUMMARY_PROMPT, text)
      await this.host.agenda.addNote(`Meeting ${clock(this.started)}: ${summary}`)
      await this.host.finish(`${summary}\nSaved to notes.`, 'MEETING SUMMARY')
    } catch {
      await this.host.agenda.addNote(`Meeting ${clock(this.started)} transcript: ${text.slice(0, 3000)}`)
      await this.host.finish("Gemini couldn't summarise it, so I saved the raw transcript to notes.")
    }
  }

  private async process() {
    if (this.busy) return
    this.busy = true
    try {
      while (this.queue.length) {
        const seg = this.queue.shift()!
        try {
          const said = await transcribe(seg.wav, await this.host.settings.get('groq'))
          await this.host.usage.add(seg.seconds)
          if (!isNoise(said)) {
            this.transcript.push(said)
            if (!this.stopping) void this.host.display.set(ID.body, `Recording. Press to stop and summarise.\n\n...${said.slice(-120)}`)
          }
        } catch (err) {
          console.warn('[meeting] transcription failed', err)
        }
      }
    } finally {
      this.busy = false
    }
  }
}
