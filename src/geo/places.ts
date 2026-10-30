import { requestJson } from '../net/http'
import { distanceBearing, type Fix } from './location'

export type Place = { name: string; lat: number; lon: number; distance: number; bearing: number; address?: string }

const PHOTON = 'https://photon.komoot.io'

function toPlace(fix: Fix, f: any, fallbackName: string): Place {
  const [lon, lat] = f.geometry.coordinates
  const p = f.properties ?? {}
  const { distance, bearing } = distanceBearing(fix.lat, fix.lon, lat, lon)
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  return { name: String(p.name ?? (street || fallbackName)), lat, lon, distance, bearing, address: [street, p.city].filter(Boolean).join(', ') }
}

/** Closest places of an OSM type (e.g. amenity:pharmacy) within `radiusKm`, nearest first. */
export async function nearby(fix: Fix, osmTag: string, label: string, radiusKm = 2): Promise<Place[]> {
  // Reverse lookup filters by type and distance; a text search would only
  // match places with the category word in their name.
  const r = await requestJson<any>(
    `${PHOTON}/reverse?limit=25&radius=${radiusKm}&lang=en&lat=${fix.lat}&lon=${fix.lon}&osm_tag=${encodeURIComponent(osmTag)}`,
    {},
    10000,
  )
  return (r.features ?? [])
    .map((f: any) => toPlace(fix, f, label))
    .filter((p: Place) => p.distance <= radiusKm * 1000)
    .sort((a: Place, b: Place) => a.distance - b.distance)
}

/** A named place or address, biased towards the user; prefers results within 50 km. */
export async function findPlace(fix: Fix, query: string): Promise<Place | null> {
  const r = await requestJson<any>(
    `${PHOTON}/api?limit=5&lang=en&lat=${fix.lat}&lon=${fix.lon}&q=${encodeURIComponent(query)}`,
    {},
    10000,
  )
  const places: Place[] = (r.features ?? []).map((f: any) => toPlace(fix, f, query))
  return places.find((p) => p.distance < 50_000) ?? places[0] ?? null
}
