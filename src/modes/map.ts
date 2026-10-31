import { GLYPHS, ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import { compass, coords, describePlace, distanceBearing, metres, type Fix } from '../geo/location'
import { halves, renderMap, renderRadar, type Blip } from '../geo/render'
import { requestJson } from '../net/http'
import type { Host, Mode } from './mode'

const MAP_CHROME = { [ID.tr]: GLYPHS.tr, [ID.br]: GLYPHS.br }
const SOURCE_LABEL: Record<Fix['source'], string> = { phone: 'PHONE GPS', browser: 'BROWSER', home: 'HOME CITY' }

async function draw(host: Host, canvas: HTMLCanvasElement) {
  const [top, bottom] = await halves(canvas)
  // Send both halves even if one is rejected, so a glitch costs half the map, not all of it.
  const ok = [await host.display.image(ID.mapTop, top), await host.display.image(ID.mapBottom, bottom)]
  if (!ok.every(Boolean)) console.warn('[map] image rejected', ok)
}

/** "Open map": your position on a dark street map, zoom with swipes. */
export class MapMode implements Mode {
  readonly name = 'map'
  private zoom = 16
  private fix: Fix | null = null
  private lastRefresh = 0
  private rendering = false

  constructor(private host: Host) {}

  async enter() {
    await this.host.display.setLayout('map', { ...MAP_CHROME, [ID.header]: 'MAP', [ID.body]: 'Locating...', [ID.footer]: '© ESRI · OSM' })
    this.fix = await this.host.locator.get()
    if (!this.fix) return this.host.finish("I can't get a location. Allow location for the Even app, or set a home city.")
    await this.render(true)
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    // Swipe up (toward the top) zooms in.
    // Esri's dark grey basemap stops at zoom 16.
    const zoom = Math.max(11, Math.min(16, this.zoom - dir))
    if (zoom !== this.zoom) {
      this.zoom = zoom
      void this.render(false)
    }
  }

  tick() {
    if (Date.now() - this.lastRefresh < 30_000 || this.rendering) return
    void (async () => {
      const fix = await this.host.locator.get(0)
      // Redraw only if we've moved noticeably.
      if (fix && this.fix && distanceBearing(fix.lat, fix.lon, this.fix.lat, this.fix.lon).distance > 15) {
        this.fix = fix
        await this.render(true)
      }
      this.lastRefresh = Date.now()
    })()
  }

  private async render(describe: boolean) {
    if (!this.fix || this.rendering) return
    this.rendering = true
    this.lastRefresh = Date.now()
    try {
      void this.host.display.set(ID.header, `MAP · Z${this.zoom}`)
      const [canvas, place] = await Promise.all([renderMap(this.fix, this.zoom), describe ? describePlace(this.fix) : null])
      await draw(this.host, canvas)
      if (place) {
        const acc = this.fix.accuracy ? ` ±${Math.round(this.fix.accuracy)}m` : ''
        // Keep this short: if the panel overflows, the glasses add a scrollbar
        // and swallow the swipes that zoom the map.
        const short = (s: string) => (s.length > 22 ? s.slice(0, 21).trimEnd() + '.' : s)
        await this.host.display.set(
          ID.body,
          [short(place.line1), short(place.line2.split(',').pop()!.trim()), '', coords(this.fix), `${SOURCE_LABEL[this.fix.source]}${acc}`, 'SWIPE · ZOOM'].join('\n'),
        )
      }
    } finally {
      this.rendering = false
    }
  }
}

type Place = { name: string; fullName: string; lat: number; lon: number; distance: number; bearing: number }

/** The last radar's places, so "take me to number 2" can navigate to a blip. */
export let lastRadar: { name: string; lat: number; lon: number }[] = []

/** "Find cafes nearby": radar of the closest places of a type, via Photon (OpenStreetMap). */
export class RadarMode implements Mode {
  readonly name = 'radar'
  private pages: string[] = []
  private page = 0

  constructor(
    private host: Host,
    private category: string,
    private osmTag: string,
  ) {}

  async enter() {
    const label = this.category.replace('_', ' ').toUpperCase()
    await this.host.display.setLayout('map', { ...MAP_CHROME, [ID.header]: `RADAR · ${label}`, [ID.body]: 'Scanning...', [ID.footer]: '© OSM · PHOTON' })
    const fix = await this.host.locator.get()
    if (!fix) return this.host.finish("I can't get a location. Allow location for the Even app, or set a home city.")

    let places: Place[]
    try {
      places = await this.search(fix)
    } catch {
      return this.host.finish('The places search is not answering. Try again shortly.')
    }
    if (!places.length) return this.host.finish(`No ${this.category.replace('_', ' ')} within 2 km.`)
    lastRadar = places.map((p) => ({ name: p.fullName, lat: p.lat, lon: p.lon }))

    const blips: Blip[] = places.map((p, i) => ({ n: i + 1, distance: p.distance, bearing: p.bearing }))
    await draw(this.host, renderRadar(blips, fix.heading))
    const list = places.map((p, i) => `${i + 1} ${p.name} · ${metres(p.distance)} ${compass(p.bearing)}`).join('\n')
    this.pages = paginate(list, 250, 6)
    await this.show(0)
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const next = this.page + dir
    if (next >= 0 && next < this.pages.length) void this.show(next)
  }

  private async show(n: number) {
    this.page = n
    await this.host.display.set(ID.body, this.pages[n])
    if (this.pages.length > 1) await this.host.display.set(ID.footer, `${n + 1}/${this.pages.length} · SWIPE`)
  }

  private async search(fix: Fix): Promise<Place[]> {
    const q = this.category.replace('_', ' ')
    // Reverse lookup filters by type and distance; a text search would only
    // match places with the category word in their name.
    const r = await requestJson<any>(
      `https://photon.komoot.io/reverse?limit=25&radius=2&lang=en&lat=${fix.lat}&lon=${fix.lon}` +
        `&osm_tag=${encodeURIComponent(this.osmTag)}`,
      {},
      10000,
    )
    return (r.features ?? [])
      .map((f: any) => {
        const [lon, lat] = f.geometry.coordinates
        const { distance, bearing } = distanceBearing(fix.lat, fix.lon, lat, lon)
        // Short enough that "name · 130m SE" fits one line of the side panel.
        const name = String(f.properties.name ?? q)
        return { name: name.length > 17 ? name.slice(0, 16).trimEnd() + '.' : name, fullName: name, lat, lon, distance, bearing }
      })
      .filter((p: Place) => p.distance <= 2000)
      .sort((a: Place, b: Place) => a.distance - b.distance)
      .slice(0, 9)
  }
}
