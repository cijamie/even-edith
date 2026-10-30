import type { Agenda } from '../data/agenda'
import type { Settings } from '../settings'
import { getWeather } from '../tools/weather'
import { clock, countdown, dayLabel, isSameDay } from '../util/time'

type Weather = Awaited<ReturnType<typeof getWeather>>

const WEATHER_TTL = 10 * 60_000

/** Builds the dashboard text. Weather is fetched lazily and cached; everything else is local. */
export class Dashboard {
  private weather: { city: string; at: number; line: string; data?: Weather } | null = null
  private fetching: Promise<void> | null = null

  constructor(
    private agenda: Agenda,
    private settings: Settings,
    /** e.g. "G2 82% · CHARGING", or '' when unknown. */
    private status: () => string = () => '',
  ) {}

  /** Spoken-style morning briefing from the same data as the dashboard. */
  async briefing(now = Date.now()): Promise<string> {
    await this.refreshWeather()
    const hour = new Date(now).getHours()
    const parts = [hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.']
    const w = this.weather?.data
    if (w && !('error' in w)) {
      const r = (n?: number) => (n == null ? '?' : Math.round(n))
      parts.push(
        `${this.weather!.city}: ${r(w.now.temperatureC)}° and ${w.now.conditions}, high ${r(w.today.highC)}°, ` +
          `${r(w.today.chanceOfRainPct)}% chance of rain.`,
      )
    }
    const today = this.agenda.events.filter((e) => isSameDay(e.start, now) && e.start >= now - 3600_000)
    parts.push(
      today.length
        ? `${today.length} event${today.length > 1 ? 's' : ''} today, first ${today[0].title} at ${clock(today[0].start)}.`
        : 'Nothing on the calendar today.',
    )
    const rem = this.agenda.reminders.filter((r) => isSameDay(r.at, now))
    if (rem.length) parts.push(`${rem.length} reminder${rem.length > 1 ? 's' : ''} today.`)
    if (this.agenda.timers.length) parts.push(`${this.agenda.timers.length} timer${this.agenda.timers.length > 1 ? 's' : ''} running.`)
    const s = this.status()
    if (s) parts.push(`Glasses: ${s.replace(/^G2 /, '').toLowerCase()}.`)
    return parts.join(' ')
  }

  /** Starts a weather fetch if the cache is stale; resolves when it lands. */
  refreshWeather(): Promise<void> {
    if (this.fetching) return this.fetching
    this.fetching = (async () => {
      const city = await this.settings.homeCity()
      if (!city) {
        this.weather = { city: '', at: Date.now(), line: 'WEATHER · SET A HOME CITY ON YOUR PHONE' }
        return
      }
      if (this.weather?.city === city && Date.now() - this.weather.at < WEATHER_TTL) return
      try {
        const data = await getWeather({ location: city })
        this.weather = { city, at: Date.now(), line: weatherLine(city, data), data }
      } catch {
        this.weather = { city, at: Date.now() - WEATHER_TTL + 60_000, line: `${city.toUpperCase()} · WEATHER UNAVAILABLE` }
      }
    })().finally(() => (this.fetching = null))
    return this.fetching
  }

  render(now = Date.now()): string {
    const lines = [`${dayLabel(now)} · ${clock(now)}`, this.weather?.line ?? 'WEATHER · ...']
    const status = this.status()
    if (status) lines.push(status)

    for (const t of this.agenda.timers) {
      lines.push(`TIMER ${t.label.toUpperCase()} · ${countdown((t.endsAt - now) / 1000)}`)
    }

    // Reminders and events over the next 24 hours, in time order.
    const horizon = now + 86400_000
    const when = (ms: number) => (isSameDay(ms, now) ? clock(ms) : `${dayLabel(ms).slice(0, 3)} ${clock(ms)}`)
    const items = [
      ...this.agenda.events
        .filter((e) => (e.end ?? e.start) >= now && e.start <= horizon)
        .map((e) => ({ at: e.start, line: `CAL ${when(e.start)} · ${e.title}` })),
      ...this.agenda.reminders
        .filter((r) => r.at <= horizon)
        .map((r) => ({ at: r.at, line: `REM ${when(r.at)} · ${r.text}` })),
    ].sort((a, b) => a.at - b.at)
    lines.push(...items.map((i) => i.line))

    const note = this.agenda.notes[0]
    if (note) lines.push(`NOTE · ${note.text}`)

    if (lines.length === (status ? 3 : 2)) lines.push('Nothing scheduled. A rare luxury.')
    return lines.join('\n')
  }
}

function weatherLine(city: string, w: Weather): string {
  if ('error' in w) return `${city.toUpperCase()} · ${String(w.error).toUpperCase()}`
  const round = (n: number | undefined) => (n == null ? '?' : Math.round(n))
  return (
    `${city.toUpperCase()} ${round(w.now.temperatureC)}° · ${w.now.conditions.toUpperCase()}` +
    ` · H${round(w.today.highC)}° L${round(w.today.lowC)}° · RAIN ${round(w.today.chanceOfRainPct)}%`
  )
}
