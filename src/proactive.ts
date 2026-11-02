import type { Agenda, CalEvent } from './data/agenda'
import type { Memory } from './data/memory'
import type { Pins } from './data/pins'
import type { Locator } from './geo/location'
import { distanceBearing } from './geo/location'
import { findPlace } from './geo/places'
import { walkingRoute } from './geo/route'
import { requestJson } from './net/http'
import type { Settings } from './settings'
import { clock } from './util/time'

const RAIN_EVERY_MS = 10 * 60_000
const RAIN_QUIET_MS = 3 * 3600_000 // one warning per shower
const LEAVE_EVERY_MS = 2 * 60_000
const LEAVE_BUFFER_MS = 5 * 60_000
const LEAVE_LOOKAHEAD_MS = 3 * 3600_000
const MAX_WALK_M = 8000
const GEOFENCE_EVERY_MS = 30_000

// Capitalised words in titles that aren't names.
const NOT_NAMES = new Set(['the', 'and', 'with', 'call', 'meeting', 'lunch', 'dinner', 'coffee', 'review', 'sync', 'catch', 'weekly', 'daily', 'team', 'standup', 'interview', 'chat'])

type Travel = { minutes: number; to: string } | null

/**
 * Alerts EDITH raises without being asked: rain on the way, time to leave for
 * an event, briefs before meetings, and location reminders. Called from the
 * assistant's once-a-second tick; each check throttles itself.
 */
export class Proactive {
  private lastRain = 0
  private rainWarnedAt = 0
  private lastLeave = 0
  private lastGeofence = 0
  private travel = new Map<string, { at: number; value: Travel }>()
  private leaveSent = new Set<string>()
  private busy = false

  constructor(
    private deps: { settings: Settings; agenda: Agenda; locator: Locator; memory: Memory; pins: Pins },
  ) {}

  async check(now = Date.now()): Promise<string[]> {
    if (this.busy) return []
    this.busy = true
    const alerts: string[] = []
    try {
      if (now - this.lastGeofence > GEOFENCE_EVERY_MS && this.deps.pins.geofences.length) {
        this.lastGeofence = now
        alerts.push(...(await this.geofences()))
      }
      // Read the setting only when a check is due, not every second.
      if (now - this.lastRain <= RAIN_EVERY_MS && now - this.lastLeave <= LEAVE_EVERY_MS) return alerts
      if (!(await this.deps.settings.proactive())) {
        this.lastRain = this.lastLeave = now
        return alerts
      }
      if (now - this.lastRain > RAIN_EVERY_MS) {
        this.lastRain = now
        const rain = await this.rain(now).catch(() => null)
        if (rain) alerts.push(rain)
      }
      if (now - this.lastLeave > LEAVE_EVERY_MS) {
        this.lastLeave = now
        alerts.push(...(await this.leaveNow(now).catch(() => [])))
      }
    } finally {
      this.busy = false
    }
    return alerts
  }

  /** The heads-up before an event: who, where, how long to walk, and anything remembered about them. */
  brief(e: CalEvent, now = Date.now()): string {
    const lines = [`${e.title} at ${clock(e.start)}, in ${Math.max(1, Math.round((e.start - now) / 60_000))} minutes.`]
    if (e.guests?.length) lines.push(`With ${e.guests.slice(0, 4).join(', ')}${e.guests.length > 4 ? ` and ${e.guests.length - 4} more` : ''}.`)
    if (e.location) {
      const t = this.travel.get(e.id)?.value
      lines.push(`At ${e.location}${t ? `, ${t.minutes} min walk` : ''}.`)
    }
    const facts = this.factsAbout(e)
    if (facts.length) lines.push(...facts.map((f) => `Recall: ${f}`))
    return lines.join('\n')
  }

  private factsAbout(e: CalEvent) {
    const names = [
      ...(e.guests ?? []).map((g) => g.split(/[\s@.]/)[0]),
      ...(e.title.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => !NOT_NAMES.has(w.toLowerCase())),
    ]
      .map((n) => n.toLowerCase().replace(/[^\p{L}'-]/gu, ''))
      .filter((n) => n.length >= 3)
    if (!names.length) return []
    return this.deps.memory.all
      .filter((f) => names.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(f.text)))
      .slice(-2)
      .map((f) => f.text)
  }

  /** "Rain in about 15 minutes" when it's dry now and the next hour isn't. */
  private async rain(now: number): Promise<string | null> {
    if (now - this.rainWarnedAt < RAIN_QUIET_MS) return null
    const fix = await this.deps.locator.get(RAIN_EVERY_MS)
    if (!fix) return null
    const w = await requestJson<any>(
      `https://api.open-meteo.com/v1/forecast?latitude=${fix.lat}&longitude=${fix.lon}` +
        '&current=precipitation&minutely_15=precipitation&forecast_minutely_15=6&timeformat=unixtime',
    )
    if ((w.current?.precipitation ?? 0) >= 0.1) return null
    const times: number[] = w.minutely_15?.time ?? []
    const mm: number[] = w.minutely_15?.precipitation ?? []
    const i = times.findIndex((t, k) => t * 1000 > now && (mm[k] ?? 0) >= 0.2)
    if (i < 0 || times[i] * 1000 - now > 75 * 60_000) return null
    this.rainWarnedAt = now
    const peak = Math.max(...mm.slice(i))
    const kind = peak >= 2 ? 'Heavy rain' : peak >= 0.7 ? 'Rain' : 'Light rain'
    const minutes = Math.max(5, Math.round((times[i] * 1000 - now) / 60_000 / 5) * 5)
    return `${kind} in about ${minutes} minutes${fix.source === 'home' ? ' at home' : ''}. Umbrella advised.`
  }

  /** "Leave now for X" when walking time plus a buffer says so. */
  private async leaveNow(now: number): Promise<string[]> {
    const soon = this.deps.agenda.events.filter((e) => e.location && !e.allDay && e.start > now && e.start - now < LEAVE_LOOKAHEAD_MS && !this.leaveSent.has(e.id))
    if (!soon.length) return []
    const fix = await this.deps.locator.get(60_000)
    if (!fix || fix.source === 'home') return []
    const out: string[] = []
    for (const e of soon) {
      const cached = this.travel.get(e.id)
      if (!cached || now - cached.at > 20 * 60_000) this.travel.set(e.id, { at: now, value: await this.walkTime(fix, e.location!) })
      const t = this.travel.get(e.id)!.value
      if (!t) continue
      const leaveAt = e.start - t.minutes * 60_000 - LEAVE_BUFFER_MS
      if (now < leaveAt) continue
      this.leaveSent.add(e.id)
      if (t.minutes <= 2) continue // already there, near enough
      out.push(`Leave now for ${e.title} at ${clock(e.start)}: ${t.minutes} min walk to ${t.to}. Say "navigate to ${t.to}" for directions.`)
    }
    return out
  }

  private async walkTime(fix: { lat: number; lon: number }, location: string): Promise<Travel> {
    try {
      const place = await findPlace({ ...fix, source: 'phone' }, location)
      if (!place || place.distance > MAX_WALK_M) return null
      const route = await walkingRoute(fix, place)
      return { minutes: Math.max(1, Math.round(route.duration / 60)), to: place.name }
    } catch {
      return null
    }
  }

  private async geofences(): Promise<string[]> {
    const fix = await this.deps.locator.get(20_000)
    if (!fix || fix.source === 'home') return []
    const out: string[] = []
    for (const g of this.deps.pins.geofences) {
      if (distanceBearing(fix.lat, fix.lon, g.lat, g.lon).distance > g.radius) continue
      await this.deps.pins.remove('geofences', g.id)
      out.push(`Reminder at ${g.place}: ${g.text}`)
    }
    return out
  }
}
