import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import type { Host, Mode } from './mode'

/** Stark-style systems readout: batteries, uplinks, location, voice quota. Refreshes every few seconds. */
export class SuitMode implements Mode {
  readonly name = 'diagnostics'
  private pages: string[] = []
  private page = 0
  private lastRefresh = 0

  constructor(private host: Host) {}

  async enter() {
    await Promise.all([
      this.host.display.set(ID.header, 'SUIT DIAGNOSTICS'),
      this.host.display.set(ID.body, 'Running diagnostics...'),
      this.host.display.set(ID.footer, 'PRESS · CLOSE'),
    ])
    await this.refresh()
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const next = this.page + dir
    if (next < 0 || next >= this.pages.length) return
    this.page = next
    void this.show()
  }

  tick() {
    if (Date.now() - this.lastRefresh > 5000) void this.refresh()
  }

  private async refresh() {
    this.lastRefresh = Date.now()
    this.pages = paginate((await this.host.diagnostics()).join('\n'))
    this.page = Math.min(this.page, this.pages.length - 1)
    await this.show()
  }

  private show() {
    void this.host.display.set(ID.footer, this.pages.length > 1 ? `${this.page + 1}/${this.pages.length} · SWIPE · PRESS · CLOSE` : 'PRESS · CLOSE')
    return this.host.display.set(ID.body, this.pages[this.page])
  }
}

/** "████▁▁▁▁" for 0..100. */
export const bar = (pct: number, width = 8) => {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width)
  return '█'.repeat(filled) + '▁'.repeat(width - filled)
}
