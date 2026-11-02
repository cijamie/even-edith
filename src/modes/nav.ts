import { ID } from '../hud/layout'
import { distanceBearing, metres, type Fix } from '../geo/location'
import { findPlace, nearby, type Place } from '../geo/places'
import { RouteFollower, walkingRoute } from '../geo/route'
import { renderMap } from '../geo/render'
import { draw, MAP_CHROME } from './map'
import type { Host, Mode } from './mode'

const ZOOM = 16
const REDRAW_MS = 6000 // map images are slow over Bluetooth; text updates every fix
const REDRAW_METRES = 25
const REROUTE_MS = 20_000

/** Walking navigation: route map with the next turn, distance and street on the side. */
export class NavMode implements Mode {
  readonly name = 'navigate'
  private dest: Place | null = null
  private follower: RouteFollower | null = null
  private unwatch: (() => void) | null = null
  private fix: Fix | null = null
  private lastDraw = { at: 0, lat: 0, lon: 0, step: -1 }
  private drawing = false
  private lastReroute = 0
  private done = false

  constructor(
    private host: Host,
    private query?: string,
    private category?: { label: string; osmTag: string },
    /** A known point (a saved pin, the nearest A&E) instead of a search. */
    private to?: { name: string; lat: number; lon: number },
  ) {}

  async enter() {
    const { display, locator } = this.host
    await display.setLayout('map', { ...MAP_CHROME, [ID.header]: 'NAVIGATION', [ID.body]: 'Locating...', [ID.footer]: '© OSM · OSRM' })
    const fix = await locator.get(0)
    if (!fix || fix.source === 'home') return this.host.finish('Navigation needs the phone location. Allow location for the Even app.')
    this.fix = fix

    void display.set(ID.body, 'Finding the place...')
    try {
      this.dest = this.to
        ? { ...this.to, ...distanceBearing(fix.lat, fix.lon, this.to.lat, this.to.lon) }
        : this.category
          ? ((await nearby(fix, this.category.osmTag, this.category.label, 3))[0] ?? null)
          : this.query
            ? await findPlace(fix, this.query)
            : null
    } catch {
      return this.host.finish('The places search is not answering. Try again shortly.')
    }
    if (!this.dest) return this.host.finish(`I couldn't find ${this.category ? `a ${this.category.label} nearby` : (this.query ?? 'that place')}.`)
    if (this.dest.distance > 30_000) return this.host.finish(`${this.dest.name} is ${metres(this.dest.distance)} away. That's beyond walking range.`)

    void display.set(ID.body, 'Plotting route...')
    if (!(await this.plan(fix))) return this.host.finish("I couldn't plot a walking route there.")
    // So "take me back" works afterwards without having dropped a pin first.
    if (!this.to) void this.host.pins.drop('where I set off', fix.lat, fix.lon, true)
    // The side panel's header fits ~18 characters.
    const name = this.dest.name.toUpperCase()
    void display.set(ID.header, `TO ${name.length > 14 ? name.slice(0, 13).trimEnd() + '.' : name}`)
    void display.set(ID.footer, 'PRESS · END')
    this.onFix(fix)
    this.unwatch = locator.watch((f) => this.onFix(f))
  }

  async exit() {
    this.unwatch?.()
    this.unwatch = null
  }

  private async plan(from: Fix) {
    this.lastReroute = Date.now()
    try {
      this.follower = new RouteFollower(await walkingRoute(from, this.dest!))
      this.lastDraw.step = -1
      return true
    } catch (err) {
      console.warn('[nav] route failed', err)
      return false
    }
  }

  private onFix(fix: Fix) {
    if (this.done || !this.follower) return
    this.fix = fix
    const p = this.follower.update(fix)
    if (p.arrived) {
      this.done = true
      void this.host.finish(`You have arrived at ${this.dest!.name}.`, 'ARRIVED')
      return
    }
    if (p.offRoute && Date.now() - this.lastReroute > REROUTE_MS) {
      void this.host.display.set(ID.footer, 'REROUTING')
      void this.plan(fix).then(() => {
        void this.host.display.set(ID.footer, 'PRESS · END')
        this.onFix(fix)
      })
      return
    }

    // Side panel: distance to the turn, the turn, the street, then the total.
    const minutes = Math.max(1, Math.round(p.toDest / 80)) // ~4.8 km/h
    const street = p.step.name.length > 20 ? p.step.name.slice(0, 19).trimEnd() + '.' : p.step.name
    void this.host.display.set(
      ID.body,
      [p.step.turn === null ? metres(p.toDest) : metres(p.toStep), p.step.short, street, '', `${metres(p.toDest)} · ${minutes} MIN`].join('\n'),
    )

    const moved = Math.hypot((fix.lat - this.lastDraw.lat) * 111_000, (fix.lon - this.lastDraw.lon) * 70_000)
    const stepChanged = this.follower.next !== this.lastDraw.step
    if (stepChanged || (moved > REDRAW_METRES && Date.now() - this.lastDraw.at > REDRAW_MS)) void this.redraw()
  }

  private async redraw() {
    if (this.drawing || !this.fix || !this.follower) return
    this.drawing = true
    const fix = this.fix
    const { route, next } = this.follower
    this.lastDraw = { at: Date.now(), lat: fix.lat, lon: fix.lon, step: next }
    try {
      const step = route.steps[Math.min(next, route.steps.length - 1)]
      const canvas = await renderMap(fix, ZOOM, { route: route.coords, target: [this.dest!.lat, this.dest!.lon], turn: step.turn })
      if (!this.done) await draw(this.host, canvas)
    } finally {
      this.drawing = false
    }
  }
}
