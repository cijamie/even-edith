import { AppLocationAccuracy, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { requestJson } from '../net/http'
import type { Settings } from '../settings'

export type Fix = { lat: number; lon: number; accuracy?: number; heading?: number; source: 'phone' | 'browser' | 'home' }

/**
 * Where the user is: the phone's GPS via the Even app, then the browser's
 * geolocation (desktop/Pages), then the home city's coordinates.
 */
export class Locator {
  private last: { fix: Fix; at: number } | null = null

  constructor(
    private bridge: EvenAppBridge,
    private settings: Settings,
  ) {}

  async get(maxAgeMs = 15_000): Promise<Fix | null> {
    if (this.last && Date.now() - this.last.at < maxAgeMs) return this.last.fix
    const fix = (await this.fromPhone()) ?? (await this.fromBrowser()) ?? (await this.fromHome())
    if (fix) this.last = { fix, at: Date.now() }
    return fix
  }

  private async fromPhone(): Promise<Fix | null> {
    try {
      const loc = await Promise.race([
        this.bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: 8000 }),
        new Promise<null>((r) => setTimeout(() => r(null), 9000)),
      ])
      if (!loc || !Number.isFinite(loc.latitude) || (loc.latitude === 0 && loc.longitude === 0)) return null
      const heading = loc.heading != null && loc.heading >= 0 ? loc.heading : undefined
      return { lat: loc.latitude, lon: loc.longitude, accuracy: loc.accuracy, heading, source: 'phone' }
    } catch {
      return null
    }
  }

  private fromBrowser(): Promise<Fix | null> {
    if (!('geolocation' in navigator)) return Promise.resolve(null)
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            accuracy: p.coords.accuracy,
            heading: p.coords.heading ?? undefined,
            source: 'browser',
          }),
        () => resolve(null),
        { timeout: 6000, maximumAge: 60_000 },
      ),
    )
  }

  private async fromHome(): Promise<Fix | null> {
    const city = await this.settings.homeCity()
    if (!city) return null
    try {
      const r = await requestJson<any>(
        `https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&name=${encodeURIComponent(city.split(',')[0])}`,
      )
      const p = r.results?.[0]
      return p ? { lat: p.latitude, lon: p.longitude, source: 'home' } : null
    } catch {
      return null
    }
  }
}

/** Street-level description via Nominatim (OpenStreetMap). */
export async function describePlace(fix: Fix): Promise<{ line1: string; line2: string }> {
  try {
    const r = await requestJson<any>(
      // accept-language as a parameter, not a header: a custom header would force a CORS preflight.
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=en&lat=${fix.lat}&lon=${fix.lon}`,
      {},
      8000,
    )
    const a = r.address ?? {}
    return {
      line1: [a.house_number, a.road ?? a.pedestrian ?? a.footway].filter(Boolean).join(' ') || r.name || 'Unnamed road',
      line2: [a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.village].filter(Boolean).join(', '),
    }
  } catch {
    return { line1: 'Location found', line2: '' }
  }
}

export const coords = (fix: Fix) =>
  `${Math.abs(fix.lat).toFixed(4)}${fix.lat >= 0 ? 'N' : 'S'} ${Math.abs(fix.lon).toFixed(4)}${fix.lon >= 0 ? 'E' : 'W'}`

/** Metres and compass bearing between two points. */
export function distanceBearing(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  const distance = 2 * R * Math.asin(Math.sqrt(h))
  const y = Math.sin(dLon) * Math.cos(bLat * rad)
  const x = Math.cos(aLat * rad) * Math.sin(bLat * rad) - Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos(dLon)
  const bearing = (Math.atan2(y, x) / rad + 360) % 360
  return { distance, bearing }
}

export const compass = (bearing: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8]

export const metres = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`)
