import { requestJson } from '../net/http'

export const weatherDeclaration = {
  name: 'get_weather',
  description:
    'Current weather and today\'s forecast for a place. Use for any question about weather, temperature, rain, wind or what to wear.',
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

  const w = await requestJson<any>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
      '&forecast_days=1&timezone=auto',
  )
  return {
    place: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
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
    },
  }
}
