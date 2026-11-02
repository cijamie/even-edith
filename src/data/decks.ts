import type { Store } from '../store'

export type Card = { id: string; q: string; a: string; box: number; due: number }
export type Deck = { id: string; name: string; cards: Card[] }

const KEY = 'edith.decks'
const DAY = 86400_000
// Leitner boxes: how long until a card comes back after each correct answer.
const INTERVALS = [0, 1, 3, 7, 14, 30].map((d) => d * DAY)
const shortId = () => Math.random().toString(36).slice(2, 7)
const deckKey = (name: string) => name.toLowerCase().replace(/\b(my|the|deck|flashcards?|cards?)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** "question | answer" (or "question - answer", or a tab) per line. */
export function parseCards(text: string): { q: string; a: string }[] {
  return text
    .split('\n')
    .map((line) => line.split(/\s*(?:\||\t|\s-\s|::)\s*/))
    .filter((parts) => parts.length >= 2 && parts[0].trim() && parts[1].trim())
    .map(([q, ...a]) => ({ q: q.trim(), a: a.join(' - ').trim() }))
}

/** Flashcard decks with spaced repetition. */
export class Decks {
  private data: Deck[] = []
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    this.data = await this.store.getJson<Deck[]>(KEY, [])
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  private async save() {
    await this.store.setJson(KEY, this.data)
    this.listeners.forEach((fn) => fn())
  }

  get all() {
    return this.data.map((d) => ({ ...d, cards: [...d.cards] }))
  }

  find(name?: string): Deck | undefined {
    if (!name) return this.data.find((d) => this.due(d).length) ?? this.data[0]
    const k = deckKey(name)
    return this.data.find((d) => deckKey(d.name) === k) ?? this.data.find((d) => deckKey(d.name).includes(k) || k.includes(deckKey(d.name)))
  }

  /** Adds cards to a deck (created if needed), skipping questions it already has. */
  async add(name: string, cards: { q: string; a: string }[]) {
    let deck = this.find(name)
    if (!deck || deckKey(deck.name) !== deckKey(name)) {
      deck = { id: shortId(), name: name.trim() || 'Cards', cards: [] }
      this.data.push(deck)
    }
    const have = new Set(deck.cards.map((c) => c.q.toLowerCase()))
    const fresh = cards.filter((c) => !have.has(c.q.toLowerCase()))
    deck.cards.push(...fresh.map((c) => ({ id: shortId(), q: c.q, a: c.a, box: 0, due: 0 })))
    await this.save()
    return { deck: deck.name, added: fresh.length, total: deck.cards.length }
  }

  async removeDeck(id: string) {
    this.data = this.data.filter((d) => d.id !== id)
    await this.save()
  }

  /** Cards due now, least-known first. */
  due(deck: Deck, now = Date.now()) {
    return deck.cards.filter((c) => c.due <= now).sort((a, b) => a.box - b.box || a.due - b.due)
  }

  /** Got it: up a box and back later. Again: back to box 0, due now. */
  async grade(deckId: string, cardId: string, correct: boolean) {
    const card = this.data.find((d) => d.id === deckId)?.cards.find((c) => c.id === cardId)
    if (!card) return
    card.box = correct ? Math.min(INTERVALS.length - 1, card.box + 1) : 0
    card.due = Date.now() + INTERVALS[card.box]
    await this.save()
  }
}
