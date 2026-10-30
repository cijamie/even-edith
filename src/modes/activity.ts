import { ID } from '../hud/layout'
import { distanceBearing, type Fix } from '../geo/location'
import { clock, countdown } from '../util/time'
import type { Activity } from '../tools'
import type { Host, Mode } from './mode'

// Faster than this between fixes is a GPS jump, not movement (m/s).
const MAX_SPEED: Record<Activity, number> = { walk: 4, run: 8, ride: 25 }
const MILES = typeof navigator !== 'undefined' && navigator.language === 'en-US'

const dist = (m: number) => (MILES ? `${(m / 1609.344).toFixed(2)} mi` : `${(m / 1000).toFixed(2)} km`)
/** Minutes per km (or mile) as m:ss, or speed for rides. */
const pace = (kind: Activity, metres: number, seconds: number) => {
  if (metres < 20 || seconds < 10) return '--'
  const unit = MILES ? 1609.344 : 1000
  if (kind === 'ride') return `${((metres / unit) / (seconds / 3600)).toFixed(1)} ${MILES ? 'mph' : 'km/h'}`
  return `${countdown((seconds / metres) * unit)} /${MILES ? 'mi' : 'km'}`
}

/** GPS walk, run or ride tracker. Press pauses; swipe down while paused finishes and saves a note. */
export class ActivityMode implements Mode {
  readonly name = 'activity'
  private started = Date.now()
  private movingMs = 0
  private resumedAt = Date.now()
  private paused = false
  private metres = 0
  private last: Fix | null = null
  /** Recent fixes for the current pace (last ~60 s). */
  private recent: { at: number; metres: number }[] = []
  private unwatch: (() => void) | null = null
  private saved = false

  constructor(
    private host: Host,
    private kind: Activity,
  ) {}

  async enter() {
    this.started = this.resumedAt = Date.now()
    await this.host.display.set(ID.header, `● ${this.kind.toUpperCase()} · GPS...`)
    this.unwatch = this.host.locator.watch((f) => this.onFix(f))
    this.render()
  }

  async exit() {
    this.unwatch?.()
    this.unwatch = null
    await this.save()
  }

  press() {
    if (this.paused) {
      this.paused = false
      this.resumedAt = Date.now()
      this.last = null // don't count the distance covered while paused
    } else {
      this.paused = true
      this.movingMs += Date.now() - this.resumedAt
    }
    this.render()
    return true
  }

  swipe(dir: 1 | -1) {
    if (dir === 1 && this.paused) void this.save().then((summary) => this.host.finish(summary ?? 'Nothing to save.', 'ACTIVITY SAVED'))
  }

  tick() {
    this.render()
  }

  private elapsed() {
    return (this.movingMs + (this.paused ? 0 : Date.now() - this.resumedAt)) / 1000
  }

  private onFix(fix: Fix) {
    if (this.paused || (fix.accuracy ?? 0) > 35) return
    if (this.last) {
      const d = distanceBearing(this.last.lat, this.last.lon, fix.lat, fix.lon).distance
      const dt = (Date.now() - (this.recent.at(-1)?.at ?? Date.now())) / 1000
      // Ignore jitter while standing still, and jumps.
      if (d < Math.max(3, (fix.accuracy ?? 5) * 0.4)) return
      if (dt > 0 && d / dt > MAX_SPEED[this.kind]) return
      this.metres += d
    }
    this.last = fix
    this.recent = [...this.recent, { at: Date.now(), metres: this.metres }].filter((r) => r.at > Date.now() - 60_000)
  }

  private render() {
    const secs = this.elapsed()
    const first = this.recent[0]
    const lastR = this.recent.at(-1)
    const now = first && lastR && lastR.at - first.at > 15_000 ? pace(this.kind, lastR.metres - first.metres, (lastR.at - first.at) / 1000) : '--'
    const label = this.kind === 'ride' ? 'SPEED' : 'PACE'
    void this.host.display.set(ID.header, `${this.paused ? '|| PAUSED' : '●'} ${this.kind.toUpperCase()} · ${countdown(secs)}`)
    void this.host.display.set(ID.body, [dist(this.metres), `${label} ${pace(this.kind, this.metres, secs)}`, `NOW ${now}`, '', `STARTED ${clock(this.started)}`].join('\n'))
    void this.host.display.set(ID.footer, this.paused ? 'PRESS · RESUME   SWIPE DOWN · FINISH' : 'PRESS · PAUSE')
  }

  /** Saves a note once; returns the summary, or null if nothing was tracked. */
  private async save(): Promise<string | null> {
    if (this.saved) return null
    this.saved = true
    if (!this.paused) this.movingMs += Date.now() - this.resumedAt
    this.paused = true
    const secs = this.movingMs / 1000
    if (this.metres < 20 && secs < 60) return null
    const summary = `${this.kind.charAt(0).toUpperCase() + this.kind.slice(1)} ${clock(this.started)}: ${dist(this.metres)} in ${countdown(secs)}, ${this.kind === 'ride' ? 'avg' : 'pace'} ${pace(this.kind, this.metres, secs)}.`
    await this.host.agenda.addNote(summary)
    return summary
  }
}
