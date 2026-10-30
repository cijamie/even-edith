import { GLYPHS, ID } from '../hud/layout'
import { REACTOR_FRAMES, reactorFrame } from '../hud/reactor'
import { HELMET_FRAMES, helmetFrame } from '../hud/helmet'
import { sleep } from '../hud/typewriter'
import { draw, MAP_CHROME } from './map'
import type { Host, Mode } from './mode'

const POWER = '▁▂▃▄▅▆▇█'
const LOG = ['> SHELL ... PLATED', '> FACEPLATE ... DOWN', '> FACEPLATE ... SEALED', '> HUD ... ONLINE']

/**
 * "I am Iron Man": the arc reactor overcharges, then the helmet assembles
 * with a suit-up log alongside. Press the ring to skip.
 */
export class IronManMode implements Mode {
  readonly name = 'iron man'
  private running = true

  constructor(private host: Host) {}

  async enter() {
    const { display } = this.host

    // Act 1: the reactor spins up, then pulses as the power climbs past safe limits.
    await display.setLayout('boot', {
      [ID.tl]: GLYPHS.tl,
      [ID.tr]: GLYPHS.tr,
      [ID.bl]: GLYPHS.bl,
      [ID.br]: GLYPHS.br,
      [ID.header]: 'ARC REACTOR',
      [ID.footer]: 'STARK INDUSTRIES',
    })
    for (let n = 0; n < REACTOR_FRAMES && this.running; n++) {
      void display.set(ID.header, `ARC REACTOR  ${POWER.slice(0, Math.round(((n + 1) / REACTOR_FRAMES) * POWER.length))}`)
      await display.image(ID.reactor, await reactorFrame(n))
      await sleep(140)
    }
    for (const [i, pct] of [150, 250, 400].entries()) {
      if (!this.running) return
      void display.set(ID.header, `POWER ${pct}%`)
      void display.set(ID.footer, i === 2 ? '● OUTPUT CRITICAL ●' : 'OVERCHARGING')
      await display.image(ID.reactor, await reactorFrame(i % 2 ? 5 : 4))
      await sleep(260)
    }
    if (!this.running) return
    await display.image(ID.reactor, await reactorFrame(5))
    await sleep(400)

    // Act 2: the helmet assembles, with the suit-up log beside it.
    if (!this.running) return
    await display.setLayout('map', { ...MAP_CHROME, [ID.header]: 'SUIT UP', [ID.body]: '', [ID.footer]: 'MARK LXXXV' })
    let log = ''
    for (let n = 0; n < HELMET_FRAMES && this.running; n++) {
      await draw(this.host, helmetFrame(n))
      if (n >= 1 && n - 1 < LOG.length) {
        log += `${LOG[n - 1]}\n`
        void display.set(ID.body, log)
      }
      await sleep(n === HELMET_FRAMES - 1 ? 300 : 120)
    }
    if (!this.running) return
    void display.set(ID.body, `${log}\nI AM IRON MAN.`)
    void display.set(ID.header, '● SUIT ONLINE')
    await sleep(2200)

    // Act 3: back to the HUD for EDITH's verdict.
    if (this.running) await this.host.finish("Suit integrity 100%. Repulsors charged. Do try not to fly into anything.", 'SUIT UP COMPLETE')
  }

  async exit() {
    this.running = false
  }
}
