import type { Store } from '../store'
import { clock, dayLabel, isSameDay } from '../util/time'

export const CATEGORIES = ['personal', 'health', 'preference', 'people', 'work', 'place', 'temporary', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export type Fact = { id: string; text: string; at: number; category?: Category; expiresAt?: number }

const KEY = 'edith.memory'
const MAX = 60

/**
 * Long-term facts about the user ("I'm allergic to peanuts"), included in every
 * prompt. Short-lived ones ("parked on level 3") carry an expiry and vanish by
 * themselves; when memory is full, those go before permanent facts.
 */
export class Memory {
  private facts: Fact[] = []
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    this.facts = await this.store.getJson<Fact[]>(KEY, [])
    if (this.prune()) await this.save()
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  get all() {
    this.prune()
    return [...this.facts]
  }

  async add(text: string, category: Category = 'other', expiresAt?: number) {
    const fact: Fact = { id: Math.random().toString(36).slice(2, 7), text, at: Date.now(), category, ...(expiresAt && { expiresAt }) }
    this.prune()
    this.facts.push(fact)
    // Once full, drop expiring facts first, then the oldest, so the prompt stays small.
    while (this.facts.length > MAX) {
      const i = this.facts.findIndex((f) => f.expiresAt)
      this.facts.splice(i >= 0 ? i : 0, 1)
    }
    await this.save()
    return fact
  }

  async remove(id: string) {
    const before = this.facts.length
    this.facts = this.facts.filter((f) => f.id !== id)
    await this.save()
    return before - this.facts.length
  }

  /** For the system prompt, grouped by category. */
  promptBlock() {
    const facts = this.all
    if (!facts.length) return ''
    const groups = new Map<string, string[]>()
    for (const f of facts) {
      const c = f.category ?? 'other'
      groups.set(c, [...(groups.get(c) ?? []), `[${f.id}] ${f.text}${f.expiresAt ? ` (until ${until(f.expiresAt)})` : ''}`])
    }
    return (
      'Things the user has asked you to remember (use them when relevant): ' +
      [...groups].map(([c, items]) => `${c}: ${items.join('; ')}`).join('. ') +
      '.'
    )
  }

  private prune(now = Date.now()) {
    const before = this.facts.length
    this.facts = this.facts.filter((f) => !f.expiresAt || f.expiresAt > now)
    return this.facts.length !== before
  }

  private async save() {
    await this.store.setJson(KEY, this.facts)
    this.listeners.forEach((fn) => fn())
  }
}

/** "18:00" today, otherwise "SAT 31 OCT 18:00". */
export const until = (ms: number) => (isSameDay(ms, Date.now()) ? clock(ms) : `${dayLabel(ms)} ${clock(ms)}`)
