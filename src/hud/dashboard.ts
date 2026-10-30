import type { Agenda } from '../data/agenda'
import type { Settings } from '../settings'
import { getWeather } from '../tools/weather'
import { clock, countdown, dayLabel, isSameDay } from '../util/time'

type Weather = Awaited<ReturnType<typeof getWeather>>

const WEATHER_TTL = 10 * 60_000

/** Builds the dashboard text. Weather is fetched lazily and cached; everything else is local. */
export class Dashboard {
  private weather: { city: string; at: number; line: string } | null = null
  private fetching: Promise<void> | null = null

  constructor(
    private agenda: Agenda,
    private settings: Settings,
  ) {}

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
        this.weather = { city, at: Date.now(), line: weatherLine(city, await getWeather({ location: city })) }
      } catch {
        this.weather = { city, at: Date.now() - WEATHER_TTL + 60_000, line: `${city.toUpperCase()} · WEATHER UNAVAILABLE` }
      }
    })().finally(() => (this.fetching = null))
    return this.fetching
  }

  render(now = Date.now()): string {
    const lines = [`${dayLabel(now)} · ${clock(now)}`, this.weather?.line ?? 'WEATHER · ...']

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

    if (lines.length === 2) lines.push('Nothing scheduled. A rare luxury.')
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
