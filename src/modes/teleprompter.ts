import { ID } from '../hud/layout'
import { paginate } from '../hud/paginate'
import type { Host, Mode } from './mode'

/** Shows the script saved on the phone page, one screen at a time. */
export class TeleprompterMode implements Mode {
  readonly name = 'teleprompter'
  private pages: string[] = []
  private page = 0

  constructor(private host: Host) {}

  async enter() {
    const script = (await this.host.settings.teleprompter()).trim()
    if (!script) return this.host.finish('No script loaded. Paste one into the teleprompter card in the phone app.')
    this.pages = paginate(script)
    await this.host.display.set(ID.header, 'TELEPROMPTER')
    await this.show(0)
  }

  async exit() {}

  swipe(dir: 1 | -1) {
    const next = this.page + dir
    if (next >= 0 && next < this.pages.length) void this.show(next)
  }

  /** Lets the phone remote jump to a page. */
  async show(n: number) {
    this.page = n
    await Promise.all([
      this.host.display.set(ID.body, this.pages[n]),
      this.host.display.set(ID.footer, `${n + 1}/${this.pages.length} · SWIPE · PRESS TO CLOSE`),
    ])
  }
}
