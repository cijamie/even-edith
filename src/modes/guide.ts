import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import { countdown, spokenDuration } from '../util/time'
import type { Host, Mode } from './mode'

const GUIDE_PROMPT =
  'Write step-by-step instructions for display on smart glasses, one step per line. Plain text, no markdown, no numbering, ' +
  'no headings. The first line is a short title (max 4 words). Then 4 to 12 steps, each under 25 words. ' +
  'Put ingredient amounts inside the step that uses them. Include explicit times like "simmer for 10 minutes" where they matter.'

type Step = { text: string; seconds?: number }

const UNIT: Record<string, number> = { s: 1, sec: 1, second: 1, m: 60, min: 60, minute: 60, h: 3600, hr: 3600, hour: 3600 }

/** "simmer for 8-10 minutes" → 600. Takes the upper end of a range. */
export function stepSeconds(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i)
  if (!m) return undefined
  const unit = m[3].toLowerCase().replace(/s$/, '')
  const n = Number(m[2] ?? m[1]) * (UNIT[unit] ?? 60)
  return n > 0 && n <= 86400 ? Math.round(n) : undefined
}

/** Splits pasted or generated text into steps, dropping list numbering. */
export function parseSteps(text: string): { title: string; steps: Step[] } {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:step\s*)?\d+[.):]\s*|^\s*[-*•]\s*/i, '').trim())
    .filter(Boolean)
  const title = lines.length > 1 && lines[0].split(/\s+/).length <= 6 && !stepSeconds(lines[0]) ? lines.shift()! : 'GUIDE'
  return { title, steps: lines.map((t) => ({ text: t, seconds: stepSeconds(t) })) }
}

/** Recipes and how-tos, one step per screen. A step with a time gets a one-press timer. */
export class GuideMode implements Mode {
  readonly name = 'guide'
  private title = 'GUIDE'
  private steps: Step[] = []
  private at = 0
  /** Timer ids started from this guide, by step. */
  private timers = new Map<number, string>()
  /** Steps whose timer has already run, so a press there closes instead. */
  private started = new Set<number>()
  private doneFlash: { step: number; until: number } | null = null

  constructor(
    private host: Host,
    private topic?: string,
  ) {}

  async enter() {
    const { display, settings, brain } = this.host
    await Promise.all([display.set(ID.header, 'GUIDE'), display.set(ID.body, this.topic ? 'Preparing steps...' : ' '), display.set(ID.footer, ' ')])
    let text = ''
    if (this.topic) {
      try {
        text = await brain.complete(GUIDE_PROMPT, this.topic)
      } catch {
        return this.host.finish("I couldn't put the steps together. Try again in a moment.")
      }
    } else {
      text = await settings.guide()
      if (!text.trim()) return this.host.finish('No recipe loaded. Paste one into the guide card in the phone app, or ask me for one.')
    }
    const parsed = parseSteps(text)
    if (!parsed.steps.length) return this.host.finish('That guide has no steps.')
    this.title = parsed.title
    this.steps = parsed.steps
    await this.show(0)
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const next = this.at + dir
    if (next >= 0 && next < this.steps.length) void this.show(next)
  }

  press() {
    const step = this.steps[this.at]
    if (!step.seconds || this.timers.has(this.at) || this.started.has(this.at)) return false
    const at = this.at
    const label = `${this.title.toLowerCase()} step ${at + 1}`
    void this.host.agenda.addTimer(step.seconds, label).then((t) => {
      this.timers.set(at, t.id)
      void this.footer()
    })
    return true
  }

  tick() {
    for (const [step, id] of this.timers) {
      if (!this.host.agenda.timers.some((t) => t.id === id)) {
        this.timers.delete(step)
        this.started.add(step)
        this.doneFlash = { step, until: Date.now() + 15_000 }
      }
    }
    if (this.timers.size || this.doneFlash) void this.footer()
    if (this.doneFlash && Date.now() > this.doneFlash.until) this.doneFlash = null
  }

  private async show(n: number) {
    this.at = n
    const page = paginate(`STEP ${n + 1}/${this.steps.length}\n${this.steps[n].text}`)[0]
    await Promise.all([this.host.display.set(ID.header, this.title.toUpperCase().slice(0, 28)), this.host.display.set(ID.body, page), this.footer()])
  }

  private footer() {
    // Any running timer from this guide shows here, since alerts wait until the mode closes.
    const running = [...this.timers.entries()]
      .map(([step, id]) => ({ step, t: this.host.agenda.timers.find((t) => t.id === id) }))
      .filter((x) => x.t)
      .map((x) => `S${x.step + 1} ${countdown((x.t!.endsAt - Date.now()) / 1000)}`)
    const step = this.steps[this.at]
    const offer = step?.seconds && !this.timers.has(this.at) && !this.started.has(this.at)
    const hint = offer
      ? `PRESS · ${spokenDuration(step.seconds!).toUpperCase()} TIMER`
      : this.at < this.steps.length - 1
        ? 'SWIPE · NEXT STEP'
        : 'PRESS · CLOSE'
    const flash = this.doneFlash && Date.now() < this.doneFlash.until ? `● STEP ${this.doneFlash.step + 1} TIMER DONE` : ''
    // A timer on offer stays visible alongside ones already running.
    const status = flash || (running.length ? (offer ? [hint, ...running] : running).join(' · ') : hint)
    return this.host.display.set(ID.footer, status)
  }
}
