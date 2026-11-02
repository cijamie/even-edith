import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import { requestJson } from '../net/http'
import { compass, coords, distanceBearing, metres, type Fix } from '../geo/location'
import { nearby } from '../geo/places'
import type { Host, Mode } from './mode'

const OVERPASS = 'https://overpass-api.de/api/interpreter'

/** ae: a hospital known to have an emergency department; hospital: one that may not. */
type Kind = 'ae' | 'hospital' | 'pharmacy' | 'police' | 'aed'
type Found = { kind: Kind; name: string; lat: number; lon: number; distance: number; bearing: number }

const LABEL: Record<Kind, string> = { ae: 'A&E', hospital: 'HOSPITAL', pharmacy: 'PHARMACY', police: 'POLICE', aed: 'DEFIB' }

/** Local emergency number from the phone's region. */
export function emergencyNumber() {
  const region = (navigator.language.split('-')[1] ?? '').toUpperCase()
  if (region === 'GB') return '999 or 112'
  if (['US', 'CA', 'MX'].includes(region)) return '911'
  if (region === 'AU') return '000'
  if (region === 'IN') return '112'
  return '112'
}

/** An OpenStreetMap link to a point, for sharing where you are. */
export const mapLink = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=18/${lat.toFixed(5)}/${lon.toFixed(5)}`

/**
 * Nearest A&E, pharmacy, police and defibrillator from OpenStreetMap. Overpass
 * can pick out hospitals with an emergency department and find defibrillators,
 * but its public servers are often overloaded, so Photon is the fallback.
 */
export async function emergencyServices(fix: Fix): Promise<Found[]> {
  // Both at once: Photon answers in about a second; Overpass gets a few seconds more to beat it.
  const overpass = fromOverpass(fix).catch((err) => {
    console.warn('[emergency] Overpass failed, using Photon', err)
    return null
  })
  const photon = await fromPhoton(fix)
  const better = await Promise.race([overpass, new Promise<null>((r) => setTimeout(() => r(null), photon.length ? 3000 : 9000))])
  return better?.length ? better : photon
}

// Photon can't tell an A&E from a private clinic, so prefer places named like hospitals.
const HOSPITAL_NAME = /hospital|infirmary|medical cent(re|er)|a ?& ?e|emergency/i
const NOT_SERVICE = /\b(former|museum|old)\b/i

async function fromPhoton(fix: Fix): Promise<Found[]> {
  const search = (kind: Kind, tag: string, km: number) =>
    nearby(fix, tag, LABEL[kind].toLowerCase(), km)
      .then((ps) => ps.filter((p) => !NOT_SERVICE.test(p.name)).map((p) => ({ kind, name: p.name, lat: p.lat, lon: p.lon, distance: p.distance, bearing: p.bearing })))
      .catch(() => [] as Found[])
  const [hospitals, pharmacies, police] = await Promise.all([
    search('hospital', 'amenity:hospital', 10),
    search('pharmacy', 'amenity:pharmacy', 3),
    search('police', 'amenity:police', 6),
  ])
  const named = hospitals.filter((h) => HOSPITAL_NAME.test(h.name))
  return [...(named.length ? named : hospitals), ...pharmacies, ...police].sort((a, b) => a.distance - b.distance)
}

async function fromOverpass(fix: Fix): Promise<Found[]> {
  const at = `${fix.lat},${fix.lon}`
  const query = `[out:json][timeout:8];(
    nwr(around:10000,${at})[amenity=hospital][emergency=yes];
    nwr(around:3000,${at})[amenity=pharmacy];
    nwr(around:6000,${at})[amenity=police];
    node(around:1500,${at})[emergency=defibrillator];
  );out center 80;`
  // A form body keeps it a simple request: no CORS preflight.
  const r = await requestJson<{ elements?: any[] }>(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) }, 9000)
  const found: Found[] = (r.elements ?? []).map((e) => {
    const lat = e.lat ?? e.center?.lat
    const lon = e.lon ?? e.center?.lon
    const t = e.tags ?? {}
    const kind: Kind = t.emergency === 'defibrillator' ? 'aed' : t.amenity === 'hospital' ? 'ae' : t.amenity === 'police' ? 'police' : 'pharmacy'
    const name = t.name || (kind === 'aed' ? t['defibrillator:location'] || 'Defibrillator' : LABEL[kind].toLowerCase())
    return { kind, name: String(name), lat, lon, ...distanceBearing(fix.lat, fix.lon, lat, lon) }
  })
  return found.filter((f) => Number.isFinite(f.lat)).sort((a, b) => a.distance - b.distance)
}

/**
 * "Jarvis, emergency": nearest A&E, pharmacy, police and defibrillator, the
 * local emergency number, and a pinned map link saved to notes for sharing
 * from the phone. Press to walk to the nearest A&E.
 */
export class EmergencyMode implements Mode {
  readonly name = 'emergency'
  private pages: string[] = []
  private page = 0
  private ae: Found | undefined

  constructor(private host: Host) {}

  async enter() {
    const { display, locator } = this.host
    await Promise.all([
      display.set(ID.header, '● EMERGENCY PROTOCOL ●'),
      display.set(ID.body, `CALL ${emergencyNumber()}\nLocating...`),
      display.set(ID.footer, 'PRESS · CLOSE'),
    ])
    const fix = await locator.get(0)
    if (!fix || fix.source === 'home') return this.host.finish(`I can't get your location. Call ${emergencyNumber()} and tell them where you are.`, '● EMERGENCY ●')

    const link = mapLink(fix.lat, fix.lon)
    await Promise.all([
      this.host.pins.drop('emergency', fix.lat, fix.lon, true),
      this.host.agenda.addNote(`Emergency location ${new Date().toLocaleString('en-GB')}: ${coords(fix)} ${link}`),
    ])
    void display.set(ID.body, `CALL ${emergencyNumber()}\n${coords(fix)}\nScanning for help nearby...`)

    let found: Found[] = []
    try {
      found = await emergencyServices(fix)
    } catch {
      // Still useful without the search: the number and your position.
    }
    const nearest = (['ae', 'hospital', 'pharmacy', 'police', 'aed'] as Kind[]).map((k) => found.find((f) => f.kind === k)).filter((f): f is Found => !!f)
    this.ae = nearest.find((f) => f.kind === 'ae') ?? nearest.find((f) => f.kind === 'hospital')
    const short = (s: string) => (s.length > 22 ? s.slice(0, 21).trimEnd() + '.' : s)
    const lines = [
      `CALL ${emergencyNumber()}`,
      ...nearest.map((f) => `${LABEL[f.kind]} ${short(f.name)} · ${metres(f.distance)} ${compass(f.bearing)}`),
      ...(nearest.length ? [] : ['No services found nearby.']),
      `YOU ${coords(fix)}`,
      'Map link saved to notes: share it from the phone.',
    ]
    this.pages = paginate(lines.join('\n'))
    await this.show(0)
  }

  async exit() {}

  press() {
    if (!this.ae) return false
    const { name, lat, lon } = this.ae
    void this.host.run({ type: 'navigate', to: { name, lat, lon } })
    return true
  }

  swipe(dir: 1 | -1) {
    const next = this.page + dir
    if (next >= 0 && next < this.pages.length) void this.show(next)
  }

  private async show(n: number) {
    this.page = n
    const more = this.pages.length > 1 ? `${n + 1}/${this.pages.length} · ` : ''
    await Promise.all([
      this.host.display.set(ID.body, this.pages[n]),
      this.host.display.set(ID.footer, `${more}${this.ae ? `PRESS · ROUTE TO ${this.ae.kind === 'ae' ? 'A&E' : 'HOSPITAL'}` : 'PRESS · CLOSE'}`),
    ])
  }
}
