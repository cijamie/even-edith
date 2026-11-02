import type { Store } from '../store'

export type Pin = { id: string; label: string; lat: number; lon: number; at: number; auto?: boolean }
export type Geofence = { id: string; text: string; place: string; lat: number; lon: number; radius: number; at: number }

type Data = { pins: Pin[]; geofences: Geofence[] }

const KEY = 'edith.pins'
const MAX_PINS = 20
const shortId = () => Math.random().toString(36).slice(2, 7)
const words = (s: string) => s.toLowerCase().replace(/\b(my|the|a|where i|i)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Saved spots ("where I parked") for "take me back to the car", and
 * location reminders ("remind me to buy batteries when I get to Tesco").
 */
export class Pins {
  private data: Data = { pins: [], geofences: [] }
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    const saved = await this.store.getJson<Partial<Data>>(KEY, {})
    this.data = { pins: saved.pins ?? [], geofences: saved.geofences ?? [] }
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  private async save() {
    await this.store.setJson(KEY, this.data)
    this.listeners.forEach((fn) => fn())
  }

  /** Newest first. */
  get pins() {
    return [...this.data.pins].sort((a, b) => b.at - a.at)
  }

  get geofences() {
    return [...this.data.geofences]
  }

  async drop(label: string, lat: number, lon: number, auto = false) {
    // One pin per label: parking again replaces the old parking spot.
    const key = words(label)
    const pin: Pin = { id: shortId(), label: label.trim() || 'pin', lat, lon, at: Date.now(), auto: auto || undefined }
    // Automatic pins only replace other automatic ones, so they never overwrite one you dropped.
    const kept = this.data.pins.filter((p) => words(p.label) !== key || (auto && !p.auto))
    this.data.pins = [...kept, pin].sort((a, b) => b.at - a.at).slice(0, MAX_PINS)
    await this.save()
    return pin
  }

  /** By fuzzy label ("the car" finds "car"); with no label, the newest pin you dropped yourself. */
  find(label?: string): Pin | undefined {
    const pins = this.pins
    if (!label) return pins.find((p) => !p.auto) ?? pins[0]
    const k = words(label)
    return pins.find((p) => words(p.label) === k) ?? pins.find((p) => words(p.label).includes(k) || k.includes(words(p.label)))
  }

  async addGeofence(text: string, place: string, lat: number, lon: number, radius = 150) {
    const g: Geofence = { id: shortId(), text, place, lat, lon, radius, at: Date.now() }
    this.data.geofences.push(g)
    await this.save()
    return g
  }

  async remove(kind: keyof Data, id: string) {
    const before = this.data[kind].length
    ;(this.data[kind] as { id: string }[]) = this.data[kind].filter((x) => x.id !== id)
    const removed = before - this.data[kind].length
    if (removed) await this.save()
    return removed
  }
}
