import type { Store } from '../store'

export type Item = { id: string; text: string; done: boolean }
export type List = { id: string; name: string; items: Item[] }

const KEY = 'edith.lists'
const shortId = () => Math.random().toString(36).slice(2, 7)
/** "My Shopping List" and "shopping" are the same list. */
const listKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(my|the|list)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const itemKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Checklists (shopping, packing, to-do), ticked off with the ring or by voice. */
export class Lists {
  private data: List[] = []
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    this.data = await this.store.getJson<List[]>(KEY, [])
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  private async save() {
    await this.store.setJson(KEY, this.data)
    this.listeners.forEach((fn) => fn())
  }

  get all() {
    return this.data.map((l) => ({ ...l, items: [...l.items] }))
  }

  find(name: string): List | undefined {
    const k = listKey(name)
    return this.data.find((l) => listKey(l.name) === k) ?? this.data.find((l) => listKey(l.name).includes(k) || k.includes(listKey(l.name)))
  }

  async add(name: string, texts: string[]) {
    let list = this.find(name)
    if (!list) {
      const clean = listKey(name) || 'to-do'
      list = { id: shortId(), name: clean.charAt(0).toUpperCase() + clean.slice(1), items: [] }
      this.data.push(list)
    }
    const added: string[] = []
    for (const text of texts.map((t) => t.trim()).filter(Boolean)) {
      const existing = list.items.find((i) => itemKey(i.text) === itemKey(text))
      if (existing) existing.done = false
      else list.items.push({ id: shortId(), text, done: false })
      added.push(text)
    }
    await this.save()
    return { list: list.name, added }
  }

  /** Finds an item by fuzzy text; returns the item or undefined. */
  item(list: List, text: string) {
    const k = itemKey(text)
    return list.items.find((i) => itemKey(i.text) === k) ?? list.items.find((i) => itemKey(i.text).includes(k) || k.includes(itemKey(i.text)))
  }

  async setDone(listId: string, itemId: string, done: boolean) {
    const item = this.data.find((l) => l.id === listId)?.items.find((i) => i.id === itemId)
    if (!item) return false
    item.done = done
    await this.save()
    return true
  }

  async removeItem(listId: string, itemId: string) {
    const list = this.data.find((l) => l.id === listId)
    if (!list) return false
    const before = list.items.length
    list.items = list.items.filter((i) => i.id !== itemId)
    await this.save()
    return list.items.length < before
  }

  /** Removes ticked items, or every item; an emptied list is deleted. */
  async clear(listId: string, doneOnly: boolean) {
    const list = this.data.find((l) => l.id === listId)
    if (!list) return 0
    const before = list.items.length
    list.items = doneOnly ? list.items.filter((i) => !i.done) : []
    if (!list.items.length) this.data = this.data.filter((l) => l.id !== listId)
    await this.save()
    return before - list.items.length
  }
}
