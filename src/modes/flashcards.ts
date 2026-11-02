import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import type { Card, Deck } from '../data/decks'
import type { Host, Mode } from './mode'

/** Flashcards: press to flip, then swipe down for "got it" or up for "again" (press again ends). */
export class FlashcardMode implements Mode {
  readonly name = 'flashcards'
  private deck: Deck | undefined
  private queue: Card[] = []
  private flipped = false
  private right = 0
  private wrong = 0

  constructor(
    private host: Host,
    private deckName?: string,
  ) {}

  async enter() {
    const { decks } = this.host
    this.deck = decks.find(this.deckName)
    if (!this.deck) {
      return this.host.finish(
        this.deckName
          ? `No deck called ${this.deckName}. Ask me to make one, like "make flashcards on French verbs".`
          : 'No flashcards yet. Paste some in the phone app, or ask me to make a deck on any topic.',
      )
    }
    this.queue = decks.due(this.deck)
    if (!this.queue.length) return this.host.finish(`Nothing due in ${this.deck.name}. All ${this.deck.cards.length} cards are learnt for now.`)
    await this.host.display.set(ID.header, `${this.deck.name.toUpperCase()} · ${this.queue.length} DUE`)
    await this.show()
  }

  async exit() {}

  /** Flips the card; on a flipped card, closes the deck. */
  press() {
    if (this.flipped) return false
    this.flipped = true
    void this.show()
    return true
  }

  swipe(dir: 1 | -1) {
    if (!this.flipped || !this.deck) return
    const card = this.queue.shift()!
    const correct = dir === 1
    if (correct) this.right++
    else {
      this.wrong++
      // Missed cards come round again this session, a few cards later.
      this.queue.splice(Math.min(3, this.queue.length), 0, card)
    }
    void this.host.decks.grade(this.deck.id, card.id, correct)
    this.flipped = false
    if (!this.queue.length) {
      void this.host.finish(`${this.deck.name} done: ${this.right} right, ${this.wrong} to practise. I'll bring cards back as they're due.`, 'FLASHCARDS')
      return
    }
    void this.host.display.set(ID.header, `${this.deck.name.toUpperCase()} · ${this.queue.length} LEFT`)
    void this.show()
  }

  private async show() {
    const card = this.queue[0]
    const text = this.flipped ? `${card.q}\n\n» ${card.a}` : card.q
    await Promise.all([
      this.host.display.set(ID.body, paginate(text)[0]),
      this.host.display.set(ID.footer, this.flipped ? '▼ GOT IT · ▲ AGAIN · PRESS END' : 'PRESS · FLIP'),
    ])
  }
}
