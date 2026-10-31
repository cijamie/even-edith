import type { Agenda } from './data/agenda'
import { distanceBearing, metres, type Fix, type Locator } from './geo/location'
import { requestJson } from './net/http'
import type { Settings } from './settings'
import { RADAR_CATEGORIES } from './tools'

const RAIN_EVERY = 10 * 60_000
const RAIN_QUIET = 3 * 3600_000
const PLACES_EVERY = 90_000
const NEAR_M = 150
const SHOP_QUIET = 4 * 3600_000

/**
 * Speaks up without being asked: rain about to start, a place reminder when
 * you're near the right kind of shop, your shopping list when you pass a
 * supermarket. Runs only while EDITH is open, and checks sparingly so the
 * free services aren't hammered.
 */
export class Proactive {
  private lastRain = 0
  private lastPlaces = 0
  private lastPlaceFix: Fix | null = null
  private running = false

  constructor(
    private agenda: Agenda,
    private settings: Settings,
    private locator: Locator,
    private alert: (text: string) => void,
  ) {}

  async tick(now = Date.now()) {
    if (this.running) return
    this.running = true
    try {
      if (!(await this.settings.proactive())) return
      if (now - this.lastRain >= RAIN_EVERY) {
        this.lastRain = now
        await this.checkRain(now)
      }
      if (now - this.lastPlaces >= PLACES_EVERY) {
        this.lastPlaces = now
        await this.checkPlaces(now)
      }
    } catch (err) {
      console.warn('[proactive]', err)
    } finally {
      this.running = false
    }
  }

  /** "Rain from about 14:30": dry now, wet in one of the next four 15-minute slots. */
  private async checkRain(now: number) {
    if (now - Number((await this.settings.getState('lastRainAlert')) || 0) < RAIN_QUIET) return
    const fix = await this.locator.get(10 * 60_000)
    if (!fix) return
    const r = await requestJson<any>(
      `https://api.open-meteo.com/v1/forecast?latitude=${fix.lat}&longitude=${fix.lon}` +
        '&current=precipitation&minutely_15=precipitation&forecast_minutely_15=5&timezone=auto',
      {},
      10000,
    )
    if ((r.current?.precipitation ?? 0) >= 0.1) return
    const times: string[] = r.minutely_15?.time ?? []
    const rain: number[] = r.minutely_15?.precipitation ?? []
    // Slot 0 is the current quarter hour; times are local to the place.
    const i = rain.findIndex((mm, k) => k > 0 && mm >= 0.2)
    if (i < 0 || !times[i]) return
    await this.settings.setState('lastRainAlert', String(now))
    const at = times[i].slice(11, 16)
    this.alert(`Rain from about ${at}. An umbrella would be wise.`)
  }

  private async checkPlaces(now: number) {
    const reminders = this.agenda.places
    const shopping = this.agenda.list('shopping')?.items.filter((i) => !i.done) ?? []
    if (!reminders.length && !shopping.length) return
    const fix = await this.locator.get(60_000)
    // Only with a real fix, and only after moving, so standing still costs nothing.
    if (!fix || fix.source === 'home') return
    if (this.lastPlaceFix && distanceBearing(fix.lat, fix.lon, this.lastPlaceFix.lat, this.lastPlaceFix.lon).distance < 40) return
    this.lastPlaceFix = fix

    for (const r of reminders) {
      if (r.lat != null && r.lon != null) {
        const d = distanceBearing(fix.lat, fix.lon, r.lat, r.lon).distance
        if (d > NEAR_M) continue
        this.alert(`You're near ${r.label}. Reminder: ${r.text}`)
      } else if (r.category) {
        const place = await nearest(fix, RADAR_CATEGORIES[r.category] ?? r.category)
        if (!place) continue
        this.alert(`${place.name} is ${metres(place.distance)} away. Reminder: ${r.text}`)
      } else continue
      await this.agenda.remove('places', [r.id])
    }

    if (shopping.length && now - Number((await this.settings.getState('lastShopAlert')) || 0) > SHOP_QUIET) {
      const shop = await nearest(fix, RADAR_CATEGORIES.supermarket)
      if (shop) {
        await this.settings.setState('lastShopAlert', String(now))
        const items = shopping.slice(0, 4).map((i) => i.text).join(', ')
        const more = shopping.length > 4 ? ` and ${shopping.length - 4} more` : ''
        this.alert(`${shop.name} is ${metres(shop.distance)} away. Shopping list: ${items}${more}.`)
      }
    }
  }
}

/** Closest place with an OSM tag within NEAR_M, via Photon. */
async function nearest(fix: Fix, osmTag: string) {
  const r = await requestJson<any>(
    `https://photon.komoot.io/reverse?limit=5&radius=${NEAR_M / 1000}&lang=en&lat=${fix.lat}&lon=${fix.lon}&osm_tag=${encodeURIComponent(osmTag)}`,
    {},
    10000,
  )
  const places = (r.features ?? [])
    .map((f: any) => {
      const [lon, lat] = f.geometry.coordinates
      return { name: String(f.properties?.name ?? 'A shop'), distance: distanceBearing(fix.lat, fix.lon, lat, lon).distance }
    })
    .filter((p: { distance: number }) => p.distance <= NEAR_M)
    .sort((a: { distance: number }, b: { distance: number }) => a.distance - b.distance)
  return places[0] ?? null
}
