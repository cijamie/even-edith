import type { Store } from '../store'

export type Timer = { id: string; label: string; endsAt: number; seconds: number }
export type Reminder = { id: string; text: string; at: number }
export type CalEvent = { id: string; title: string; start: number; end?: number }
export type Note = { id: string; text: string; createdAt: number }

type Data = { timers: Timer[]; reminders: Reminder[]; events: CalEvent[]; notes: Note[] }

const KEY = 'jarvis.agenda'
const shortId = () => Math.random().toString(36).slice(2, 7)

/**
 * Timers, reminders, calendar events and notes, persisted as one JSON blob so
 * they survive the WebView reloading. Timers store their end time, not a
 * countdown, so a reload doesn't lose time.
 */
export class Agenda {
  private data: Data = { timers: [], reminders: [], events: [], notes: [] }
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    const saved = await this.store.getJson<Partial<Data>>(KEY, {})
    this.data = {
      timers: saved.timers ?? [],
      reminders: saved.reminders ?? [],
      events: saved.events ?? [],
      notes: saved.notes ?? [],
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
  get events() {
    return [...this.data.events].sort((a, b) => a.start - b.start)
  }
  get notes() {
    return [...this.data.notes].sort((a, b) => b.createdAt - a.createdAt)
  }

  async addTimer(seconds: number, label: string) {
    const t: Timer = { id: shortId(), label, seconds, endsAt: Date.now() + seconds * 1000 }
    this.data.timers.push(t)
    await this.save()
    return t
  }

  async addReminder(text: string, at: number) {
    const r: Reminder = { id: shortId(), text, at }
    this.data.reminders.push(r)
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

  /** Removes items by id from any list; returns how many were removed. */
  async remove(kind: keyof Data, ids: string[]) {
    const list = this.data[kind] as { id: string }[]
    const before = list.length
    ;(this.data[kind] as { id: string }[]) = list.filter((x) => !ids.includes(x.id))
    const removed = before - this.data[kind].length
    if (removed) await this.save()
    return removed
  }

  /** Timers and reminders whose time has come; removes them as it returns them. */
  async takeDue(now = Date.now()) {
    const timers = this.data.timers.filter((t) => t.endsAt <= now)
    const reminders = this.data.reminders.filter((r) => r.at <= now)
    if (timers.length || reminders.length) {
      this.data.timers = this.data.timers.filter((t) => t.endsAt > now)
      this.data.reminders = this.data.reminders.filter((r) => r.at > now)
      // Past events are kept a day so "what did I have this morning" still works.
      this.data.events = this.data.events.filter((e) => (e.end ?? e.start) > now - 86400000)
      await this.save()
    }
    return { timers, reminders }
  }
}
