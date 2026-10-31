import { MAP_SIZE } from '../hud/layout'
import type { Fix } from './location'

// Esri's World Dark Gray basemap (free with attribution, no key): mid-grey
// background, lighter roads. CARTO's dark tiles now return an "API key
// required" placeholder, so they're out.
const TILE_URL = (z: number, x: number, y: number) =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`
const TILE = 256
// Measured on these tiles: background ~80, buildings ~70-75, roads ~100-105.
// Everything up to just above the background goes black (off); roads go bright.
const ROAD_FLOOR = 86
const ROAD_GAIN = 12

const tiles = new Map<string, Promise<ImageBitmap | null>>()

function tile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`
  if (!tiles.has(key)) {
    tiles.set(
      key,
      fetch(TILE_URL(z, x, y))
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((b) => createImageBitmap(b))
        .then((img) => (isPlaceholder(img) ? null : img))
        .catch(() => null),
    )
    if (tiles.size > 120) tiles.delete(tiles.keys().next().value!)
  }
  return tiles.get(key)!
}

/**
 * Esri answers missing areas with a flat "map data not yet available" tile,
 * which the contrast stretch would turn into a solid bright square.
 */
function isPlaceholder(img: ImageBitmap) {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, 32, 32)
  const px = g.getImageData(0, 0, 32, 32).data
  let sum = 0
  let sq = 0
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3
    sum += l
    sq += l * l
  }
  const n = px.length / 4
  const mean = sum / n
  return mean > 120 || Math.sqrt(sq / n - mean * mean) < 2
}

/** Web Mercator world pixel coordinates at zoom z. */
function project(lat: number, lon: number, z: number) {
  const world = TILE * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * world,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world,
  }
}

/** Metres per pixel at a latitude and zoom. */
export const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z

/** A route to draw over the map: the path and a flag at the end. */
export type Overlay = { line: [number, number][]; dest: { lat: number; lon: number } }

/** Renders a north-up map centred on the fix. Returns the canvas (288x288). */
export async function renderMap(fix: Fix, zoom: number, overlay?: Overlay): Promise<HTMLCanvasElement> {
  const canvas = square()
  const g = canvas.getContext('2d')!
  const c = project(fix.lat, fix.lon, zoom)
  const left = c.x - MAP_SIZE / 2
  const top = c.y - MAP_SIZE / 2

  const jobs: Promise<void>[] = []
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + MAP_SIZE) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + MAP_SIZE) / TILE); ty++) {
      const n = 2 ** zoom
      const wx = ((tx % n) + n) % n
      jobs.push(
        tile(zoom, wx, ty).then((img) => {
          if (img) g.drawImage(img, tx * TILE - left, ty * TILE - top, TILE, TILE)
        }),
      )
    }
  }
  await Promise.all(jobs)

  // Contrast stretch: background and buildings go black (off), roads bright.
  const data = g.getImageData(0, 0, MAP_SIZE, MAP_SIZE)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] + px[i + 1] + px[i + 2]) / 3
    const v = Math.max(0, Math.min(255, (l - ROAD_FLOOR) * ROAD_GAIN))
    px[i] = px[i + 1] = px[i + 2] = v
  }
  g.putImageData(data, 0, 0)

  if (overlay) drawRoute(g, overlay, (lat, lon) => {
    const p = project(lat, lon, zoom)
    return [p.x - left, p.y - top]
  })

  // You are here: ring, dot, and a heading wedge when the phone knows it.
  const m = MAP_SIZE / 2
  g.save()
  g.translate(m, m)
  if (fix.heading != null) {
    g.rotate((fix.heading * Math.PI) / 180)
    g.fillStyle = 'rgba(255,255,255,0.55)'
    g.beginPath()
    g.moveTo(0, 0)
    g.arc(0, 0, 30, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45)
    g.closePath()
    g.fill()
    g.rotate((-fix.heading * Math.PI) / 180)
  }
  g.fillStyle = '#000'
  g.beginPath()
  g.arc(0, 0, 9, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.beginPath()
  g.arc(0, 0, 5, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#fff'
  g.lineWidth = 2
  g.beginPath()
  g.arc(0, 0, 13, 0, Math.PI * 2)
  g.stroke()
  g.restore()

  northMarker(g)
  scaleBar(g, metresPerPixel(fix.lat, zoom))
  return canvas
}

function drawRoute(g: CanvasRenderingContext2D, { line, dest }: Overlay, at: (lat: number, lon: number) => [number, number]) {
  // A black casing under a white line keeps the route readable over bright roads.
  for (const [style, width] of [['#000', 11], ['#fff', 6]] as const) {
    g.strokeStyle = style
    g.lineWidth = width
    g.lineJoin = g.lineCap = 'round'
    g.beginPath()
    line.forEach(([lat, lon], i) => {
      const [x, y] = at(lat, lon)
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    })
    g.stroke()
  }
  // Destination: a chequered flag square.
  const [x, y] = at(dest.lat, dest.lon)
  g.fillStyle = '#000'
  g.fillRect(x - 9, y - 9, 18, 18)
  g.fillStyle = '#fff'
  g.fillRect(x - 7, y - 7, 7, 7)
  g.fillRect(x, y, 7, 7)
  g.strokeStyle = '#fff'
  g.lineWidth = 1
  g.strokeRect(x - 7, y - 7, 14, 14)
}

export type Blip = { n: number; distance: number; bearing: number }

/** Radar: range rings, crosshair, numbered blips. Heading-up when the phone knows the heading. */
export function renderRadar(blips: Blip[], heading?: number): HTMLCanvasElement {
  const canvas = square()
  const g = canvas.getContext('2d')!
  const m = MAP_SIZE / 2
  const radius = m - 14
  const range = niceRange(Math.max(200, ...blips.map((b) => b.distance)))

  g.translate(m, m)
  g.strokeStyle = 'rgb(110,110,110)'
  g.lineWidth = 1
  for (const f of [1 / 3, 2 / 3, 1]) {
    g.beginPath()
    g.arc(0, 0, radius * f, 0, Math.PI * 2)
    g.stroke()
  }
  g.beginPath()
  g.moveTo(-radius, 0)
  g.lineTo(radius, 0)
  g.moveTo(0, -radius)
  g.lineTo(0, radius)
  g.stroke()

  // Sweep line for the look of the thing.
  g.strokeStyle = 'rgb(200,200,200)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(radius * Math.cos(-0.9), radius * Math.sin(-0.9))
  g.stroke()

  const up = heading ?? 0
  g.font = 'bold 15px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (const b of blips) {
    const a = ((b.bearing - up - 90) * Math.PI) / 180
    const r = (Math.min(b.distance, range) / range) * radius
    const x = r * Math.cos(a)
    const y = r * Math.sin(a)
    g.fillStyle = '#fff'
    g.fillRect(x - 3, y - 3, 6, 6)
    g.fillText(String(b.n), x + 10, y - 9)
  }

  // Centre: you.
  g.fillStyle = '#fff'
  g.beginPath()
  g.moveTo(0, -8)
  g.lineTo(6, 6)
  g.lineTo(-6, 6)
  g.closePath()
  g.fill()

  // North marker rotates with heading-up.
  const na = ((-up - 90) * Math.PI) / 180
  g.font = 'bold 14px sans-serif'
  g.fillText('N', (radius + 8) * Math.cos(na), (radius + 8) * Math.sin(na))

  g.setTransform(1, 0, 0, 1, 0, 0)
  g.font = '13px sans-serif'
  g.textAlign = 'left'
  g.fillStyle = 'rgb(200,200,200)'
  g.fillText(range < 1000 ? `${range}m` : `${range / 1000}km`, 6, MAP_SIZE - 10)
  return canvas
}

/** Splits a 288x288 canvas into the two 288x144 PNGs the image containers take. */
export async function halves(canvas: HTMLCanvasElement): Promise<[Uint8Array, Uint8Array]> {
  const half = (y: number) => {
    const c = document.createElement('canvas')
    c.width = MAP_SIZE
    c.height = MAP_SIZE / 2
    c.getContext('2d')!.drawImage(canvas, 0, y, MAP_SIZE, MAP_SIZE / 2, 0, 0, MAP_SIZE, MAP_SIZE / 2)
    return png(c)
  }
  return Promise.all([half(0), half(MAP_SIZE / 2)])
}

function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (blob) => (blob ? resolve(new Uint8Array(await blob.arrayBuffer())) : reject(new Error('toBlob failed'))), 'image/png'),
  )
}

function square() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = MAP_SIZE
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, MAP_SIZE, MAP_SIZE)
  return canvas
}

function northMarker(g: CanvasRenderingContext2D) {
  g.fillStyle = '#000'
  g.fillRect(MAP_SIZE - 26, 4, 22, 24)
  g.fillStyle = '#fff'
  g.font = 'bold 16px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('N', MAP_SIZE - 15, 17)
}

function scaleBar(g: CanvasRenderingContext2D, mpp: number) {
  const metres = niceRange(mpp * 80)
  const px = metres / mpp
  g.fillStyle = '#000'
  g.fillRect(4, MAP_SIZE - 24, px + 50, 20)
  g.strokeStyle = '#fff'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(8, MAP_SIZE - 12)
  g.lineTo(8, MAP_SIZE - 8)
  g.lineTo(8 + px, MAP_SIZE - 8)
  g.lineTo(8 + px, MAP_SIZE - 12)
  g.stroke()
  g.fillStyle = '#fff'
  g.font = '12px sans-serif'
  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.fillText(metres < 1000 ? `${metres}m` : `${metres / 1000}km`, 14 + px, MAP_SIZE - 7)
}

/** Rounds up to 1/2/5 x 10^n. */
function niceRange(v: number) {
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 5, 10].map((k) => k * p).find((n) => n >= v)!
}
