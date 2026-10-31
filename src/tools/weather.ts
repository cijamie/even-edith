import { requestJson } from '../net/http'
import { airQuality, moonPhase } from './sky'

export const weatherDeclaration = {
  name: 'get_weather',
  description:
    "Current weather and today's forecast for a place, plus sunrise, sunset, daylight, UV index, air quality and the moon phase. " +
    'Use for any question about weather, temperature, rain, wind, what to wear, the sun, the moon, UV or pollution.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City or place name, e.g. "London" or "Austin, Texas".' },
    },
    required: ['location'],
  },
}

// WMO weather codes used by Open-Meteo.
const CODES: Record<number, string> = {
  0: 'clear',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'light showers',
  81: 'showers',
  82: 'violent showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'severe thunderstorm with hail',
}

export async function getWeather({ location }: { location: string }) {
  // The geocoder matches place names only, so drop any ", region" suffix.
  const name = location.split(',')[0].trim()
  const geo = await requestJson<{ results?: any[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(name)}`,
  )
  const place = geo.results?.[0]
  if (!place) return { error: `No place called "${location}" found.` }
  return weatherAt(place.latitude, place.longitude, [place.name, place.admin1, place.country].filter(Boolean).join(', '))
}

/** Weather for coordinates, e.g. the phone's current location. Air quality is best-effort. */
export async function weatherAt(lat: number, lon: number, label: string) {
  const [w, air] = await Promise.all([
    requestJson<any>(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,daylight_duration,uv_index_max' +
        '&forecast_days=1&timezone=auto',
    ),
    airQuality(lat, lon).catch(() => undefined),
  ])
  // Local times come back as "2026-10-31T06:58"; keep the clock part.
  const hhmm = (t?: string) => (t ? t.slice(11, 16) : undefined)
  const daylight = w.daily?.daylight_duration?.[0]
  return {
    place: label,
    localTime: w.current?.time,
    now: {
      temperatureC: w.current?.temperature_2m,
      feelsLikeC: w.current?.apparent_temperature,
      conditions: CODES[w.current?.weather_code] ?? 'unknown',
      windKmh: w.current?.wind_speed_10m,
      precipitationMm: w.current?.precipitation,
    },
    today: {
      highC: w.daily?.temperature_2m_max?.[0],
      lowC: w.daily?.temperature_2m_min?.[0],
      chanceOfRainPct: w.daily?.precipitation_probability_max?.[0],
      conditions: CODES[w.daily?.weather_code?.[0]] ?? 'unknown',
      uvIndexMax: w.daily?.uv_index_max?.[0],
    },
    sun: {
      sunrise: hhmm(w.daily?.sunrise?.[0]),
      sunset: hhmm(w.daily?.sunset?.[0]),
      daylight: daylight == null ? undefined : `${Math.floor(daylight / 3600)}h ${Math.round((daylight % 3600) / 60)}m`,
    },
    airQuality: air,
    moon: moonPhase(),
  }
}
