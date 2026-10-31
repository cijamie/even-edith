import type { Store } from '../store'

export type Card = { id: string; deck: string; front: string; back: string; box: number; due: number }

const KEY = 'edith.cards'
const DAY = 86400_000
// Leitner boxes: a right answer moves a card up a box and waits longer; a wrong one sends it back to box 0.
const INTERVALS = [0, 1, 2, 4, 8, 16, 32].map((d) => d * DAY)

export const deckName = (name: string) => name.toLowerCase().replace(/\s+(?:deck|cards|flashcards)$/, '').trim() || 'general'

/** Flashcard decks with spaced repetition, for languages or anything else worth drilling. */
export class Flashcards {
  private cards: Card[] = []
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    this.cards = await this.store.getJson<Card[]>(KEY, [])
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  /** Each deck with its size and how many cards are due now. */
  decks(now = Date.now()) {
    const decks = new Map<string, { name: string; total: number; due: number }>()
    for (const c of this.cards) {
      const d = decks.get(c.deck) ?? { name: c.deck, total: 0, due: 0 }
      d.total++
      if (c.due <= now) d.due++
      decks.set(c.deck, d)
    }
    return [...decks.values()].sort((a, b) => b.due - a.due || a.name.localeCompare(b.name))
  }

  async add(deck: string, cards: { front: string; back: string }[]) {
    const name = deckName(deck)
    const seen = new Set(this.cards.filter((c) => c.deck === name).map((c) => c.front.toLowerCase()))
    let added = 0
    for (const { front, back } of cards) {
      const f = String(front ?? '').trim()
      const b = String(back ?? '').trim()
      if (!f || !b || seen.has(f.toLowerCase())) continue
      seen.add(f.toLowerCase())
      this.cards.push({ id: Math.random().toString(36).slice(2, 8), deck: name, front: f, back: b, box: 0, due: Date.now() })
      added++
    }
    await this.save()
    return { deck: name, added, total: this.cards.filter((c) => c.deck === name).length }
  }

  /** Cards to study: due ones first; if none are due, the soonest ones (reviewing ahead). */
  session(deck?: string, limit = 20, now = Date.now()) {
    const pool = this.cards.filter((c) => !deck || c.deck === deckName(deck))
    const due = pool.filter((c) => c.due <= now)
    const picked = (due.length ? due : pool).sort((a, b) => a.due - b.due).slice(0, limit)
    // Shuffle so a deck isn't always studied in the same order.
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[picked[i], picked[j]] = [picked[j], picked[i]]
    }
    return { cards: picked, reviewingAhead: !due.length && pool.length > 0 }
  }

  async grade(id: string, correct: boolean, now = Date.now()) {
    const c = this.cards.find((x) => x.id === id)
    if (!c) return
    c.box = correct ? Math.min(INTERVALS.length - 1, c.box + 1) : 0
    c.due = now + (correct ? INTERVALS[c.box] : 10 * 60_000)
    await this.save()
  }

  dueTomorrow(deck?: string, now = Date.now()) {
    return this.cards.filter((c) => (!deck || c.deck === deckName(deck)) && c.due <= now + DAY).length
  }

  async removeDeck(deck: string) {
    const name = deckName(deck)
    const before = this.cards.length
    this.cards = this.cards.filter((c) => c.deck !== name)
    await this.save()
    return before - this.cards.length
  }

  private async save() {
    await this.store.setJson(KEY, this.cards)
    this.listeners.forEach((fn) => fn())
  }
}
