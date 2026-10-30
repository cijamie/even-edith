import { requestJson } from '../net/http'
import { distanceBearing, type Fix } from './location'

// FOSSGIS's public OSRM with a foot profile (the project-osrm.org demo is car-only).
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving'

/** Arrow direction in degrees relative to straight ahead (negative = left); null = arrive. */
export type Step = { lat: number; lon: number; turn: number | null; text: string; short: string; name: string }
export type Route = { coords: [number, number][]; steps: Step[]; distance: number; duration: number }

const ANGLE: Record<string, number> = {
  uturn: 180,
  'sharp right': 135,
  right: 90,
  'slight right': 40,
  straight: 0,
  'slight left': -40,
  left: -90,
  'sharp left': -135,
}

function describe(type: string, modifier: string | undefined, name: string): { text: string; short: string } {
  const onto = name ? ` onto ${name}` : ''
  const dir = (modifier ?? 'straight').toUpperCase()
  switch (type) {
    case 'arrive':
      return { text: 'Arrive at your destination', short: 'ARRIVE' }
    case 'roundabout':
    case 'rotary':
      return { text: `Take the roundabout${onto}`, short: 'ROUNDABOUT' }
    case 'continue':
    case 'new name':
      return modifier && modifier !== 'straight'
        ? { text: `Bear ${modifier}${onto}`, short: dir }
        : { text: `Continue${onto}`, short: 'AHEAD' }
    default:
      if (!modifier || modifier === 'straight') return { text: `Go straight${onto}`, short: 'AHEAD' }
      if (modifier === 'uturn') return { text: 'Turn around', short: 'U-TURN' }
      return { text: `Turn ${modifier}${onto}`, short: dir }
  }
}

export async function walkingRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<Route> {
  const r = await requestJson<any>(
    `${OSRM_FOOT}/${from.lon},${from.lat};${to.lon},${to.lat}?steps=true&overview=full&geometries=geojson`,
    {},
    15000,
  )
  const route = r.routes?.[0]
  if (r.code !== 'Ok' || !route) throw new Error(r.message ?? 'No route found')
  const steps: Step[] = (route.legs?.[0]?.steps ?? [])
    .filter((s: any) => s.maneuver?.type !== 'depart')
    .map((s: any) => {
      const [lon, lat] = s.maneuver.location
      const type = s.maneuver.type
      const name = String(s.name ?? '')
      return {
        lat,
        lon,
        turn: type === 'arrive' ? null : (ANGLE[s.maneuver.modifier] ?? 0),
        name,
        ...describe(type, s.maneuver.modifier, name),
      }
    })
  return {
    coords: route.geometry.coordinates.map(([lon, lat]: [number, number]) => [lat, lon]),
    steps,
    distance: route.distance,
    duration: route.duration,
  }
}

/** Metres from a point to the nearest segment of the route (flat-earth approximation, fine at walking scale). */
export function offRouteDistance(fix: Fix, coords: [number, number][]) {
  const kx = 111320 * Math.cos((fix.lat * Math.PI) / 180)
  const ky = 110540
  let best = Infinity
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][1] - fix.lon) * kx
    const ay = (coords[i][0] - fix.lat) * ky
    const bx = (coords[i + 1][1] - fix.lon) * kx
    const by = (coords[i + 1][0] - fix.lat) * ky
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/**
 * Tracks progress along a route: which manoeuvre is next, how far to it, and
 * whether the walker has strayed. Steps are passed once within `reach` metres;
 * OSRM emits several tiny steps at junctions, so it looks a few ahead.
 */
export class RouteFollower {
  next = 0
  private strays = 0

  constructor(public route: Route) {}

  update(fix: Fix) {
    const reach = Math.max(12, Math.min(25, (fix.accuracy ?? 10) * 0.6))
    for (let j = Math.min(this.route.steps.length - 1, this.next + 3); j >= this.next; j--) {
      const s = this.route.steps[j]
      if (s.turn !== null && distanceBearing(fix.lat, fix.lon, s.lat, s.lon).distance < reach) {
        this.next = j + 1
        break
      }
    }
    const step = this.route.steps[Math.min(this.next, this.route.steps.length - 1)]
    const toStep = distanceBearing(fix.lat, fix.lon, step.lat, step.lon).distance
    const dest = this.route.steps[this.route.steps.length - 1]
    const toDest = distanceBearing(fix.lat, fix.lon, dest.lat, dest.lon).distance
    // Two off-route fixes in a row, so one bad GPS reading doesn't trigger a reroute.
    this.strays = offRouteDistance(fix, this.route.coords) > Math.max(35, fix.accuracy ?? 0) ? this.strays + 1 : 0
    return { step, toStep, toDest, arrived: toDest < Math.max(15, Math.min(30, fix.accuracy ?? 15)), offRoute: this.strays >= 2 }
  }
}
