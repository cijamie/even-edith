import { requestJson } from '../net/http'
import { compass, distanceBearing, metres, type Fix } from '../geo/location'
import { clock } from '../util/time'

// ── Aircraft overhead (adsb.lol ADS-B, via the user's Apps Script; adsbdb for route and type) ──

const ADSBDB = 'https://api.adsbdb.com/v0'
const FT = 0.3048

/**
 * The aircraft closest to overhead: flight, route, type, altitude, and where to
 * look. `aircraft` is adsb.lol's "ac" list (hex, flight, r, t, alt_baro in feet
 * or "ground", alt_geom, gs in knots, track, lat, lon).
 */
export async function planeOverhead(fix: Fix, aircraft: any[]) {
  const planes = aircraft
    .filter((a) => a.alt_baro !== 'ground' && Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .map((a) => {
      const { distance, bearing } = distanceBearing(fix.lat, fix.lon, a.lat, a.lon)
      const altitude = Number(a.alt_geom ?? a.alt_baro ?? 0) * FT
      // Closest to straight up, not just closest on the map: a high plane nearby beats a low one further out.
      const elevation = (Math.atan2(altitude, Math.max(distance, 1)) * 180) / Math.PI
      return { icao: String(a.hex ?? '').replace(/^~/, ''), callsign: String(a.flight ?? '').trim(), type: a.t, reg: a.r, distance, bearing, altitude, elevation, speed: Number(a.gs ?? 0) / 1.944, track: Number(a.track ?? 0) }
    })
    .sort((a, b) => b.elevation - a.elevation)
  if (!planes.length) return { error: 'No aircraft in the sky within about 28 km right now.' }

  const p = planes[0]
  const [route, details] = await Promise.all([
    p.callsign ? requestJson<any>(`${ADSBDB}/callsign/${encodeURIComponent(p.callsign)}`, {}, 8000).catch(() => null) : null,
    requestJson<any>(`${ADSBDB}/aircraft/${p.icao}`, {}, 8000).catch(() => null),
  ])
  const fr = route?.response?.flightroute
  const ac = details?.response?.aircraft
  const place = (a: any) => (a ? `${a.municipality || a.name} (${a.iata_code || a.icao_code})` : undefined)
  return {
    flight: fr?.callsign_iata || p.callsign || 'unknown',
    airline: fr?.airline?.name,
    from: place(fr?.origin),
    to: place(fr?.destination),
    aircraft: ac ? [ac.manufacturer, ac.type].filter(Boolean).join(' ') : p.type,
    registration: ac?.registration ?? p.reg,
    altitudeFt: Math.round((p.altitude * 3.281) / 100) * 100,
    speedKnots: Math.round(p.speed * 1.944),
    heading: compass(p.track),
    look: `${compass(p.bearing)}, ${Math.round(p.elevation)}° up, ${metres(p.distance)} away`,
    othersNearby: planes.length - 1,
  }
}

// ── ISS passes (wheretheiss.at positions, look angles worked out here) ──

const ISS = 'https://api.wheretheiss.at/v1/satellites/25544'
const EARTH_KM = 6371
const rad = Math.PI / 180

type IssPos = { latitude: number; longitude: number; altitude: number; visibility: string; timestamp: number }

/** Elevation (degrees above the horizon) and bearing of a point at `altKm` seen from the observer. */
export function lookAngle(obs: { lat: number; lon: number }, sat: { lat: number; lon: number; altKm: number }) {
  const ecef = (lat: number, lon: number, r: number) => [r * Math.cos(lat * rad) * Math.cos(lon * rad), r * Math.cos(lat * rad) * Math.sin(lon * rad), r * Math.sin(lat * rad)]
  const o = ecef(obs.lat, obs.lon, EARTH_KM)
  const s = ecef(sat.lat, sat.lon, EARTH_KM + sat.altKm)
  const d = s.map((v, i) => v - o[i])
  const up = o.map((v) => v / EARTH_KM)
  const range = Math.hypot(...d)
  const elevation = Math.asin(d.reduce((n, v, i) => n + v * up[i], 0) / range) / rad
  return { elevation, bearing: distanceBearing(obs.lat, obs.lon, sat.lat, sat.lon).bearing }
}

/** Sun's elevation in degrees (NOAA approximation, good to a degree or so). */
export function sunElevation(lat: number, lon: number, ms: number) {
  const days = ms / 86400_000 - 10957.5 // since J2000
  const g = (357.529 + 0.98560028 * days) * rad
  const q = 280.459 + 0.98564736 * days
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * days) * rad
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const gmst = (280.46061837 + 360.98564736629 * days) * rad
  const ha = gmst + lon * rad - ra
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad
}

async function positions(times: number[]): Promise<IssPos[]> {
  // The API takes at most 10 timestamps per request.
  const out: IssPos[] = []
  for (let i = 0; i < times.length; i += 10) {
    const batch = times.slice(i, i + 10).map((t) => Math.round(t / 1000))
    out.push(...(await requestJson<IssPos[]>(`${ISS}/positions?units=kilometers&timestamps=${batch.join(',')}`, {}, 10000)))
  }
  return out
}

/** Where the ISS is now, and its next pass above 10° in the next few hours. */
export async function issPass(fix: Fix) {
  const now = Date.now()
  const current = await requestJson<IssPos>(`${ISS}?units=kilometers`, {}, 10000)
  const nowLook = lookAngle(fix, { lat: current.latitude, lon: current.longitude, altKm: current.altitude })
  const result: Record<string, unknown> = {
    now: nowLook.elevation > 0 ? `Above the horizon: ${compass(nowLook.bearing)}, ${Math.round(nowLook.elevation)}° up.` : `Below the horizon, over ${Math.round(current.latitude)}°, ${Math.round(current.longitude)}°.`,
  }

  // Coarse scan, 2-minute steps over 4 hours, then refine around the best sample.
  const coarse = Array.from({ length: 120 }, (_, i) => now + (i + 1) * 120_000)
  const samples = (await positions(coarse)).map((p) => ({ p, ...lookAngle(fix, { lat: p.latitude, lon: p.longitude, altKm: p.altitude }) }))
  const firstUp = samples.findIndex((s) => s.elevation > 10)
  if (firstUp < 0) return { ...result, nextPass: 'No pass above 10° in the next 4 hours.' }
  // Peak of that pass (consecutive samples above the horizon).
  let peak = firstUp
  for (let i = firstUp; i < samples.length && samples[i].elevation > 0; i++) if (samples[i].elevation > samples[peak].elevation) peak = i
  const centre = samples[peak].p.timestamp * 1000
  const fine = (await positions(Array.from({ length: 10 }, (_, i) => centre - 90_000 + i * 20_000)))
    .map((p) => ({ p, ...lookAngle(fix, { lat: p.latitude, lon: p.longitude, altKm: p.altitude }) }))
    .sort((a, b) => b.elevation - a.elevation)[0]
  const at = fine.p.timestamp * 1000
  const sun = sunElevation(fix.lat, fix.lon, at)
  // Visible to the eye only if the ISS is sunlit and the sky where you are is dark.
  const visible = fine.p.visibility === 'daylight' && sun < -6
  return {
    ...result,
    nextPass: {
      peakAt: clock(at),
      inMinutes: Math.round((at - now) / 60_000),
      look: `${compass(fine.bearing)}, ${Math.round(fine.elevation)}° up`,
      nakedEye: visible ? 'yes, look for a bright steady dot moving fast' : sun >= -6 ? 'no, the sky will be too bright' : 'no, the ISS will be in Earth’s shadow',
    },
    note: 'Offer to set a reminder a few minutes before.',
  }
}
