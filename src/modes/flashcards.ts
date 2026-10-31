import { ID } from '../hud/layout'
import type { Card } from '../data/flashcards'
import type { Host, Mode } from './mode'

/**
 * Flashcard drill: press (or swipe) to reveal, then swipe up if you knew it,
 * down if not. Missed cards come back once at the end. Press after a reveal
 * ends the session early.
 */
export class FlashcardMode implements Mode {
  readonly name = 'flashcards'
  private queue: Card[] = []
  private retried = new Set<string>()
  private revealed = false
  private total = 0
  private done = 0
  private right = 0

  constructor(
    private host: Host,
    private deck?: string,
  ) {}

  async enter() {
    const { cards, reviewingAhead } = this.host.flashcards.session(this.deck)
    if (!cards.length) {
      const decks = this.host.flashcards.decks()
      return this.host.finish(
        decks.length
          ? `No deck called ${this.deck}. You have ${decks.map((d) => d.name).join(', ')}.`
          : 'No flashcards yet. Ask me to make some, e.g. "make me 15 Spanish food flashcards".',
      )
    }
    this.queue = cards
    this.total = cards.length
    if (reviewingAhead) void this.host.display.set(ID.footer, 'NOTHING DUE · REVIEWING AHEAD')
    await this.show()
  }

  async exit() {}

  press() {
    if (!this.queue.length) return false
    if (!this.revealed) void this.reveal()
    else void this.end()
    return true
  }

  swipe(dir: 1 | -1) {
    if (!this.queue.length) return
    if (!this.revealed) return void this.reveal()
    // Up (toward the top) = knew it, down = again.
    void this.grade(dir === -1)
  }

  private get header() {
    const deck = (this.deck ?? this.queue[0]?.deck ?? 'cards').toUpperCase()
    return `CARDS · ${deck} · ${Math.min(this.done + 1, this.total)}/${this.total}`
  }

  private async show() {
    this.revealed = false
    const card = this.queue[0]
    await Promise.all([
      this.host.display.set(ID.header, this.header),
      this.host.display.set(ID.body, card.front),
      this.host.display.set(ID.footer, 'PRESS · REVEAL'),
    ])
  }

  private async reveal() {
    this.revealed = true
    const card = this.queue[0]
    await Promise.all([
      this.host.display.set(ID.body, `${card.front}\n\n» ${card.back}`),
      this.host.display.set(ID.footer, '▲ KNEW IT · ▼ AGAIN'),
    ])
  }

  private async grade(correct: boolean) {
    const card = this.queue.shift()!
    // Only the first answer counts towards the schedule; a retry is practice.
    if (!this.retried.has(card.id)) {
      await this.host.flashcards.grade(card.id, correct)
      if (correct) this.right++
      this.done++
    }
    if (!correct && !this.retried.has(card.id)) {
      this.retried.add(card.id)
      this.queue.push(card)
    }
    if (this.queue.length) await this.show()
    else await this.end()
  }

  private async end() {
    const left = this.total - this.done
    const due = this.host.flashcards.dueTomorrow(this.deck)
    const score = this.done ? `${this.right} of ${this.done} right.` : 'No cards answered.'
    const rest = left > 0 ? ` ${left} left for later.` : ''
    await this.host.finish(`Session over. ${score}${rest} ${due} due in the next day.`, 'FLASHCARDS')
  }
}
