import type { Store } from '../store'

export const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const
export type Repeat = (typeof REPEATS)[number]

export type Timer = { id: string; label: string; endsAt: number; seconds: number }
export type Reminder = { id: string; text: string; at: number; repeat?: Repeat }
/** Fires when the user is near a type of place (any pharmacy) or a specific spot. */
export type PlaceReminder = { id: string; text: string; label: string; category?: string; lat?: number; lon?: number }
export type CalEvent = { id: string; title: string; start: number; end?: number; nudged?: boolean }
export type Note = { id: string; text: string; createdAt: number }
export type ListItem = { id: string; text: string; done: boolean; at: number }
export type List = { id: string; name: string; items: ListItem[] }

type Data = { timers: Timer[]; reminders: Reminder[]; places: PlaceReminder[]; events: CalEvent[]; notes: Note[]; lists: List[] }

const KEY = 'edith.agenda'
const shortId = () => Math.random().toString(36).slice(2, 7)

/** "Shopping List", "my shopping" → "shopping". */
export const listName = (name: string) =>
  name.toLowerCase().replace(/^(?:my|the)\s+/, '').replace(/\s+list$/, '').replace(/\s+/g, ' ').trim() || 'shopping'

/** Next time a repeating reminder is due after `now`. */
export function nextOccurrence(at: number, repeat: Repeat, now = Date.now()): number | null {
  if (repeat === 'none') return null
  const d = new Date(at)
  const step = () => {
    if (repeat === 'daily' || repeat === 'weekdays') d.setDate(d.getDate() + 1)
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1)
    else d.setFullYear(d.getFullYear() + 1)
  }
  do {
    step()
    while (repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1)
  } while (d.getTime() <= now)
  return d.getTime()
}

/**
 * Timers, reminders, calendar events, notes and lists, persisted as one JSON
 * blob so they survive the WebView reloading. Timers store their end time,
 * not a countdown, so a reload doesn't lose time.
 */
export class Agenda {
  private data: Data = { timers: [], reminders: [], places: [], events: [], notes: [], lists: [] }
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    const saved = await this.store.getJson<Partial<Data>>(KEY, {})
    this.data = {
      timers: saved.timers ?? [],
      reminders: saved.reminders ?? [],
      places: saved.places ?? [],
      events: saved.events ?? [],
      notes: saved.notes ?? [],
      lists: saved.lists ?? [],
    }
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  private async save() {
    await this.store.setJson(KEY, this.data)
    this.listeners.forEach((fn) => fn())
  }

  get timers() {
    return [...this.data.timers].sort((a, b) => a.endsAt - b.endsAt)
  }
  get reminders() {
    return [...this.data.reminders].sort((a, b) => a.at - b.at)
  }
  get places() {
    return [...this.data.places]
  }
  get events() {
    return [...this.data.events].sort((a, b) => a.start - b.start)
  }
  get notes() {
    return [...this.data.notes].sort((a, b) => b.createdAt - a.createdAt)
  }
  get lists() {
    return [...this.data.lists]
  }

  async addTimer(seconds: number, label: string) {
    const t: Timer = { id: shortId(), label, seconds, endsAt: Date.now() + seconds * 1000 }
    this.data.timers.push(t)
    await this.save()
    return t
  }

  async addReminder(text: string, at: number, repeat: Repeat = 'none') {
    const r: Reminder = { id: shortId(), text, at, ...(repeat !== 'none' && { repeat }) }
    this.data.reminders.push(r)
    await this.save()
    return r
  }

  async addPlaceReminder(p: Omit<PlaceReminder, 'id'>) {
    const r: PlaceReminder = { id: shortId(), ...p }
    this.data.places.push(r)
    await this.save()
    return r
  }

  async addEvent(title: string, start: number, end?: number) {
    const e: CalEvent = { id: shortId(), title, start, end }
    this.data.events.push(e)
    await this.save()
    return e
  }

  async addNote(text: string) {
    const n: Note = { id: shortId(), text, createdAt: Date.now() }
    this.data.notes.push(n)
    await this.save()
    return n
  }

  // ── Lists ────────────────────────────────────────────────────────

  list(name: string): List | undefined {
    const n = listName(name)
    return this.data.lists.find((l) => l.name === n)
  }

  /** Adds items, creating the list if needed; skips ones already on it (unticking them instead). */
  async addToList(name: string, texts: string[]) {
    let list = this.list(name)
    if (!list) {
      list = { id: shortId(), name: listName(name), items: [] }
      this.data.lists.push(list)
    }
    const added: string[] = []
    for (const raw of texts) {
      const text = raw.trim()
      if (!text) continue
      const existing = list.items.find((i) => i.text.toLowerCase() === text.toLowerCase())
      if (existing) existing.done = false
      else list.items.push({ id: shortId(), text, done: false, at: Date.now() })
      added.push(text)
    }
    await this.save()
    return { list: list.name, added }
  }

  /** Ticks (or unticks) items by id or by loose text match. */
  async markItems(name: string, match: string[], done = true) {
    const list = this.list(name)
    if (!list) return []
    const hits = findItems(list, match)
    hits.forEach((i) => (i.done = done))
    if (hits.length) await this.save()
    return hits.map((i) => i.text)
  }

  async removeItems(name: string, match: string[]) {
    const list = this.list(name)
    if (!list) return []
    const gone = findItems(list, match)
    list.items = list.items.filter((i) => !gone.includes(i))
    if (gone.length) await this.save()
    return gone.map((i) => i.text)
  }

  /** Clears ticked items (or everything); deleting the whole list when asked. */
  async clearList(name: string, onlyDone: boolean, deleteList = false) {
    const list = this.list(name)
    if (!list) return 0
    const before = list.items.length
    if (deleteList) this.data.lists = this.data.lists.filter((l) => l !== list)
    else list.items = onlyDone ? list.items.filter((i) => !i.done) : []
    await this.save()
    return deleteList ? before : before - list.items.length
  }

  /** Removes items by id from any list; returns how many were removed. */
  async remove(kind: Exclude<keyof Data, 'lists'>, ids: string[]) {
    const list = this.data[kind] as { id: string }[]
    const before = list.length
    ;(this.data[kind] as { id: string }[]) = list.filter((x) => !ids.includes(x.id))
    const removed = before - this.data[kind].length
    if (removed) await this.save()
    return removed
  }

  /** Events starting within `leadMs` that haven't had their heads-up yet; marks them as nudged. */
  async takeUpcoming(leadMs: number, now = Date.now()) {
    const soon = this.data.events.filter((e) => !e.nudged && e.start > now && e.start - now <= leadMs)
    if (soon.length) {
      soon.forEach((e) => (e.nudged = true))
      await this.save()
    }
    return soon
  }

  /**
   * Timers and reminders whose time has come. One-off ones are removed as
   * they're returned; repeating reminders move on to their next time.
   */
  async takeDue(now = Date.now()) {
    const timers = this.data.timers.filter((t) => t.endsAt <= now)
    const reminders = this.data.reminders.filter((r) => r.at <= now)
    if (timers.length || reminders.length) {
      this.data.timers = this.data.timers.filter((t) => t.endsAt > now)
      this.data.reminders = this.data.reminders.flatMap((r) => {
        if (r.at > now) return [r]
        const next = r.repeat ? nextOccurrence(r.at, r.repeat, now) : null
        return next ? [{ ...r, at: next }] : []
      })
      // Past events are kept a day so "what did I have this morning" still works.
      this.data.events = this.data.events.filter((e) => (e.end ?? e.start) > now - 86400000)
      await this.save()
    }
    return { timers, reminders }
  }
}

/** Items by id or text; an exact name wins, so "milk" doesn't also tick "oat milk". */
function findItems(list: List, match: string[]) {
  return list.items.filter((i) =>
    match.some((m) => {
      if (i.id === m) return true
      const exact = list.items.some((x) => x.text.toLowerCase() === m.toLowerCase().trim())
      return exact ? i.text.toLowerCase() === m.toLowerCase().trim() : itemMatches(i.text, m)
    }),
  )
}

/** "milk" matches "Oat milk" and "eggs" matches "egg", but "steak" doesn't match "tea". */
function itemMatches(text: string, query: string) {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w.replace(/(?:es|s)$/, ''))
  const a = words(text)
  const b = words(query)
  if (!a.length || !b.length) return false
  return b.every((w) => a.includes(w)) || a.every((w) => b.includes(w))
}
