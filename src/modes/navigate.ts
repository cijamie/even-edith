import { GLYPHS, ID } from '../hud/layout'
import { compass, distanceBearing, metres, type Fix } from '../geo/location'
import { halves, renderMap } from '../geo/render'
import { distanceToLine, findPlace, route, type Profile, type Route } from '../geo/route'
import { lastRadar } from './map'
import type { Host, Mode } from './mode'

const CHROME = { [ID.tr]: GLYPHS.tr, [ID.br]: GLYPHS.br }
const ARRIVED_M = 25
const STEP_DONE_M = 20
const OFF_ROUTE_M = 45
const SPEED: Record<Profile, string> = { foot: 'WALK', bike: 'CYCLE', car: 'DRIVE' }

export type Destination = { query?: string; radar?: number; profile?: Profile }

/**
 * Turn-by-turn directions: the route on the map, the next instruction in the
 * side panel, refreshed from the phone's location every few seconds. Reroutes
 * when you stray off the line. Swipe to zoom; press to stop.
 */
export class NavigateMode implements Mode {
  readonly name = 'navigate'
  private route: Route | null = null
  private step = 1
  private fix: Fix | null = null
  private zoom = 16
  private offRoute = 0
  private busy = false
  private lastPoll = 0
  private lastDraw = { at: 0, lat: 0, lon: 0, zoom: 0 }
  private lastPanel = ''

  constructor(
    private host: Host,
    private dest: Destination,
  ) {}

  async enter() {
    const profile = this.dest.profile ?? 'foot'
    await this.host.display.setLayout('map', { ...CHROME, [ID.header]: `ROUTE · ${SPEED[profile]}`, [ID.body]: 'Locating...', [ID.footer]: '© OSM · OSRM' })
    this.fix = await this.host.locator.get(0)
    if (!this.fix) return this.host.finish("I can't get a location. Allow location for the Even app.")
    if (this.fix.source === 'home') return this.host.finish('Directions need your real location, not the home city. Allow location for the Even app.')

    const to = await this.resolve()
    if (!to) return
    void this.host.display.set(ID.body, `Routing to\n${short(to.name, 40)}...`)
    try {
      this.route = await route(this.fix, to, profile)
    } catch {
      return this.host.finish('The route planner is not answering. Try again shortly.')
    }
    if (!this.route) return this.host.finish(`I couldn't find a route to ${to.name}.`)
    if (profile === 'foot' && this.route.distance > 30_000) return this.host.finish(`${to.name} is ${metres(this.route.distance)} away. That's a long walk; ask me to drive instead.`)
    this.step = 1
    await this.update(true)
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const zoom = Math.max(13, Math.min(16, this.zoom - dir))
    if (zoom === this.zoom) return
    this.zoom = zoom
    void this.draw()
  }

  tick() {
    if (!this.route || this.busy || Date.now() - this.lastPoll < 4000) return
    this.lastPoll = Date.now()
    this.busy = true
    void (async () => {
      try {
        const fix = await this.host.locator.get(0)
        if (fix && fix.source !== 'home') {
          this.fix = fix
          await this.update(false)
        }
      } finally {
        this.busy = false
      }
    })()
  }

  private async resolve() {
    const { query, radar } = this.dest
    if (radar != null) {
      const place = lastRadar[radar - 1]
      if (!place) {
        await this.host.finish(lastRadar.length ? `Radar only had ${lastRadar.length} places.` : 'Open a radar first, then pick a number.')
        return null
      }
      return place
    }
    if (!query) {
      await this.host.finish('Where to? Say "take me to" and a place.')
      return null
    }
    if (/^(?:home|my home|my house)$/.test(query.toLowerCase())) {
      const home = await this.host.settings.homeAddress()
      if (!home) {
        await this.host.finish('Set your home address in the phone app first.')
        return null
      }
      return this.lookup(home)
    }
    return this.lookup(query)
  }

  private async lookup(query: string) {
    try {
      const place = await findPlace(query, this.fix)
      if (place) return place
      await this.host.finish(`I can't find ${query}.`)
    } catch {
      await this.host.finish('The place search is not answering. Try again shortly.')
    }
    return null
  }

  /** Works out where we are on the route, then redraws what changed. */
  private async update(force: boolean) {
    const r = this.route!
    const fix = this.fix!
    const toEnd = distanceBearing(fix.lat, fix.lon, r.to.lat, r.to.lon)
    if (toEnd.distance <= ARRIVED_M) return this.host.finish(`You have arrived at ${r.to.name}.`, 'ARRIVED')

    // Advance past manoeuvres we've reached.
    while (this.step < r.steps.length - 1) {
      const s = r.steps[this.step]
      if (distanceBearing(fix.lat, fix.lon, s.lat, s.lon).distance > STEP_DONE_M) break
      this.step++
    }

    if (distanceToLine(fix.lat, fix.lon, r.line) > OFF_ROUTE_M + (fix.accuracy ?? 0) / 2) {
      // Two strikes, so one jumpy GPS reading doesn't trigger a reroute.
      if (++this.offRoute >= 2) return this.reroute()
    } else this.offRoute = 0

    await this.panel(toEnd.distance)
    const d = this.lastDraw
    if (force || d.zoom !== this.zoom || Date.now() - d.at > 30_000 || distanceBearing(fix.lat, fix.lon, d.lat, d.lon).distance > 40) await this.draw()
  }

  private async reroute() {
    this.offRoute = 0
    void this.host.display.set(ID.body, 'Off route.\nRerouting...')
    try {
      const fresh = await route(this.fix!, this.route!.to, this.dest.profile ?? 'foot')
      if (fresh) {
        this.route = fresh
        this.step = 1
      }
    } catch {}
    this.lastPanel = ''
    await this.draw()
    await this.panel(distanceBearing(this.fix!.lat, this.fix!.lon, this.route!.to.lat, this.route!.to.lon).distance)
  }

  private async panel(remaining: number) {
    const r = this.route!
    const fix = this.fix!
    const next = r.steps[Math.min(this.step, r.steps.length - 1)]
    const toNext = distanceBearing(fix.lat, fix.lon, next.lat, next.lon)
    const after = r.steps[this.step + 1]
    // Remaining time scaled from the route's own estimate.
    const mins = Math.max(1, Math.round(((r.duration / Math.max(1, r.distance)) * remaining) / 60))
    const lines = [
      `${metres(toNext.distance)} ${compass(toNext.bearing)}`,
      short(next.instruction, 44),
      // The side panel holds about 24 characters by 8 lines; overflowing it would
      // add a scrollbar that swallows the zoom swipes.
      after ? `then ${short(after.instruction.toLowerCase(), 18)}` : '',
      `${metres(remaining)} · ${mins} MIN`,
      short(r.to.name.toUpperCase(), 20),
    ]
    const text = lines.join('\n')
    if (text === this.lastPanel) return
    this.lastPanel = text
    await this.host.display.set(ID.body, text)
  }

  private async draw() {
    if (!this.route || !this.fix) return
    const fix = this.fix
    this.lastDraw = { at: Date.now(), lat: fix.lat, lon: fix.lon, zoom: this.zoom }
    void this.host.display.set(ID.header, `ROUTE · ${SPEED[this.dest.profile ?? 'foot']} · Z${this.zoom}`)
    const canvas = await renderMap(fix, this.zoom, { line: this.route.line, dest: this.route.to })
    const [top, bottom] = await halves(canvas)
    await this.host.display.image(ID.mapTop, top)
    await this.host.display.image(ID.mapBottom, bottom)
  }
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '.' : s)
