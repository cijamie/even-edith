import { BODY_LINES, ID } from '../hud/layout'
import type { List } from '../data/lists'
import type { Host, Mode } from './mode'

/** A checklist on the glasses: swipe to move, press to tick. The last row closes it. */
export class ListMode implements Mode {
  readonly name = 'list'
  private list: List | null = null
  private cursor = 0

  constructor(
    private host: Host,
    private wanted: string,
  ) {}

  async enter() {
    const lists = this.host.lists
    this.list = lists.find(this.wanted) ?? (this.wanted ? null : (lists.all[0] ?? null))
    if (!this.list) {
      const names = lists.all.map((l) => l.name)
      return this.host.finish(names.length ? `No list called ${this.wanted}. You have: ${names.join(', ')}.` : 'No lists yet. Say "add milk to my shopping list".')
    }
    this.cursor = 0
    await this.render()
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const rows = this.rows().length
    this.cursor = Math.max(0, Math.min(rows - 1, this.cursor + dir))
    void this.render()
  }

  press() {
    const row = this.rows()[this.cursor]
    if (!row || !this.list) return false // the CLOSE row
    void this.host.lists.setDone(this.list.id, row.id, !row.done).then(() => {
      this.list = this.host.lists.all.find((l) => l.id === this.list!.id) ?? null
      void this.render()
    })
    return true
  }

  /** Items, with null standing for the closing row. */
  private rows() {
    return [...(this.list?.items ?? []), null]
  }

  private async render() {
    if (!this.list) return
    const rows = this.rows()
    // Keep the cursor in view: a window of BODY_LINES rows.
    const start = Math.max(0, Math.min(this.cursor - Math.floor(BODY_LINES / 2), rows.length - BODY_LINES))
    const body = rows
      .slice(start, start + BODY_LINES)
      .map((r, i) => `${start + i === this.cursor ? '>' : '  '} ${r ? `${r.done ? '[x]' : '[ ]'} ${r.text}` : 'CLOSE'}`)
      .join('\n')
    const left = this.list.items.filter((i) => !i.done).length
    await Promise.all([
      this.host.display.set(ID.header, `${this.list.name.toUpperCase()} · ${left} LEFT`),
      this.host.display.set(ID.body, body),
      this.host.display.set(ID.footer, 'SWIPE · MOVE   PRESS · TICK'),
    ])
  }
}
