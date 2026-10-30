import type { Store } from '../store'

export type Fact = { id: string; text: string; at: number }

const KEY = 'edith.memory'
const MAX = 60

/** Long-term facts about the user ("I'm allergic to peanuts"), included in every prompt. */
export class Memory {
  private facts: Fact[] = []

  constructor(private store: Store) {}

  async load() {
    this.facts = await this.store.getJson<Fact[]>(KEY, [])
  }

  get all() {
    return [...this.facts]
  }

  async add(text: string) {
    const fact = { id: Math.random().toString(36).slice(2, 7), text, at: Date.now() }
    // Oldest drop off first once full, so the prompt stays small.
    this.facts = [...this.facts, fact].slice(-MAX)
    await this.store.setJson(KEY, this.facts)
    return fact
  }

  async remove(id: string) {
    const before = this.facts.length
    this.facts = this.facts.filter((f) => f.id !== id)
    await this.store.setJson(KEY, this.facts)
    return before - this.facts.length
  }

  /** For the system prompt. */
  promptBlock() {
    if (!this.facts.length) return ''
    return 'Things the user has asked you to remember (use them when relevant): ' + this.facts.map((f) => `[${f.id}] ${f.text}`).join('; ') + '.'
  }
}
