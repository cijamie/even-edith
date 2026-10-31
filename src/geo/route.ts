import { requestJson } from '../net/http'
import { compass, distanceBearing, type Fix } from './location'

export const PROFILES = ['foot', 'bike', 'car'] as const
export type Profile = (typeof PROFILES)[number]

export type Step = { instruction: string; distance: number; lat: number; lon: number }
export type Route = { steps: Step[]; line: [number, number][]; distance: number; duration: number; to: { lat: number; lon: number; name: string } }

// FOSSGIS runs free OSRM servers for walking, cycling and driving (CORS enabled).
const ROUTER = (p: Profile) => `https://routing.openstreetmap.de/routed-${p}/route/v1/${p === 'foot' ? 'foot' : p === 'bike' ? 'bike' : 'driving'}`

/** Finds a named place near the user with Photon (OpenStreetMap). */
export async function findPlace(query: string, near: Fix | null) {
  const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : ''
  const r = await requestJson<any>(`https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(query)}${bias}`, {}, 10000)
  const f = r.features?.[0]
  if (!f) return null
  const [lon, lat] = f.geometry.coordinates
  const p = f.properties ?? {}
  const name = [p.name ?? p.street, p.city ?? p.town ?? p.district].filter(Boolean).join(', ') || query
  return { lat, lon, name }
}

export async function route(from: Fix, to: { lat: number; lon: number; name: string }, profile: Profile = 'foot'): Promise<Route | null> {
  const r = await requestJson<any>(
    `${ROUTER(profile)}/${from.lon},${from.lat};${to.lon},${to.lat}?steps=true&overview=full&geometries=geojson`,
    {},
    12000,
  )
  const best = r?.routes?.[0]
  if (r?.code !== 'Ok' || !best) return null
  const steps: Step[] = best.legs.flatMap((leg: any) =>
    leg.steps.map((s: any) => ({
      instruction: instruction(s),
      distance: s.distance,
      lon: s.maneuver.location[0],
      lat: s.maneuver.location[1],
    })),
  )
  return {
    steps,
    line: best.geometry.coordinates.map(([lon, lat]: number[]) => [lat, lon]),
    distance: best.distance,
    duration: best.duration,
    to,
  }
}

/** Turns an OSRM step into "Turn left onto Oxford Street". */
function instruction(s: any): string {
  const m = s.maneuver ?? {}
  const road = s.name || s.ref || ''
  const onto = road ? ` onto ${road}` : ''
  const mod = String(m.modifier ?? '')
  switch (m.type) {
    case 'depart':
      return `Head ${compass(m.bearing_after ?? 0)}${road ? ` on ${road}` : ''}`
    case 'arrive':
      return 'Arrive at destination'
    case 'roundabout':
    case 'rotary':
      return `At the roundabout, take exit ${m.exit ?? 1}${onto}`
    case 'exit roundabout':
    case 'exit rotary':
      return `Leave the roundabout${onto}`
    case 'new name':
    case 'continue':
      return mod === 'uturn' ? `Make a U-turn${onto}` : `Continue${mod && mod !== 'straight' ? ` ${mod}` : ''}${onto}`
    case 'merge':
      return `Merge${mod ? ` ${mod}` : ''}${onto}`
    case 'fork':
      return `Keep ${mod.replace('slight ', '') || 'straight'} at the fork${onto}`
    case 'end of road':
      return `At the end of the road, turn ${mod}${onto}`
    case 'on ramp':
    case 'off ramp':
      return `Take the ramp${mod ? ` on the ${mod.replace('slight ', '')}` : ''}${onto}`
    default:
      if (mod === 'uturn') return `Make a U-turn${onto}`
      if (mod === 'straight' || !mod) return `Go straight${onto}`
      return `Turn ${mod}${onto}`
  }
}

/** Metres from a point to the nearest point of a polyline (flat-earth, fine at street scale). */
export function distanceToLine(lat: number, lon: number, line: [number, number][]) {
  const k = Math.cos((lat * Math.PI) / 180)
  const toXY = ([a, b]: [number, number]) => [(b - lon) * k * 111_320, (a - lat) * 111_320]
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = toXY(line[i - 1])
    const [x2, y2] = toXY(line[i])
    const dx = x2 - x1
    const dy = y2 - y1
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len)) : 0
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy))
  }
  return line.length === 1 ? distanceBearing(lat, lon, line[0][0], line[0][1]).distance : best
}
