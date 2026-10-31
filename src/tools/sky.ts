import { requestJson } from '../net/http'

const SYNODIC = 29.530588853
// A known new moon: 6 Jan 2000 18:14 UTC.
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)
const PHASES = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent']

/** Moon phase from the date alone; good to within a few hours. */
export function moonPhase(ms = Date.now()) {
  const age = ((((ms - NEW_MOON) / 86400_000) % SYNODIC) + SYNODIC) % SYNODIC
  const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100)
  return { phase: PHASES[Math.round((age / SYNODIC) * 8) % 8], illuminationPct: illumination, ageDays: Math.round(age * 10) / 10 }
}

/** European AQI bands. */
export const aqiLabel = (aqi?: number) =>
  aqi == null ? 'unknown' : aqi <= 20 ? 'good' : aqi <= 40 ? 'fair' : aqi <= 60 ? 'moderate' : aqi <= 80 ? 'poor' : aqi <= 100 ? 'very poor' : 'extremely poor'

/** Air quality from Open-Meteo (CAMS data, free, no key). */
export async function airQuality(lat: number, lon: number) {
  const r = await requestJson<any>(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      '&current=european_aqi,us_aqi,pm2_5,pm10,ozone,uv_index&timezone=auto',
    {},
    8000,
  )
  const c = r?.current ?? {}
  return {
    europeanAqi: c.european_aqi,
    usAqi: c.us_aqi,
    rating: aqiLabel(c.european_aqi),
    pm2_5: c.pm2_5,
    pm10: c.pm10,
    ozone: c.ozone,
    uvIndexNow: c.uv_index,
  }
}
