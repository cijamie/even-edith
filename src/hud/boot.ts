import type { Display } from './display'
import { GLYPHS, ID } from './layout'
import { REACTOR_FRAMES, reactorFrame } from './reactor'
import { sleep, typewrite } from './typewriter'

export type Check = { label: string; ok: boolean }

const POWER = '▁▂▃▄▅▆▇█'

/**
 * Stark Industries boot, three acts:
 * 1. Arc reactor spins up, brackets draw in, power bar fills.
 * 2. Initialising: systems check.
 * 3. EDITH appears: E.D.I.T.H. // ONLINE, tagline, greeting.
 * Expects the display to be on the 'boot' layout; leaves it on 'hud'.
 */
export async function boot(display: Display, checks: Check[], greeting: string) {
  const t0 = performance.now()

  // Act 1: the reactor. Brackets grow alongside the first frames.
  void display.set(ID.footer, 'STARK INDUSTRIES')
  let imagesOk = true
  for (let n = 0; n < REACTOR_FRAMES && imagesOk; n++) {
    const bars = Math.round(((n + 1) / REACTOR_FRAMES) * POWER.length)
    const g = Math.min(3, n + 1)
    void display.set(ID.tl, GLYPHS.tl.slice(0, g))
    void display.set(ID.tr, GLYPHS.tr.slice(0, g))
    void display.set(ID.bl, GLYPHS.bl.slice(0, g))
    void display.set(ID.br, GLYPHS.br.slice(0, g))
    void display.set(ID.header, `ARC REACTOR  ${POWER.slice(0, bars)}`)
    imagesOk = await display.image(ID.reactor, await reactorFrame(n))
    await sleep(160)
  }
  await display.set(ID.header, 'ARC REACTOR  ONLINE')
  await sleep(imagesOk ? 700 : 300)

  // Drop the reactor image (rebuild to the plain HUD), keeping brackets and footer.
  const kept = await display.setLayout('hud', {
    [ID.tl]: GLYPHS.tl,
    [ID.tr]: GLYPHS.tr,
    [ID.bl]: GLYPHS.bl,
    [ID.br]: GLYPHS.br,
    [ID.footer]: 'STARK INDUSTRIES',
  })
  if (!kept) console.warn('[boot] rebuild without reactor failed')

  // Act 2: initialising.
  await typewrite(display, ID.header, 'INITIALISING...', { cps: 50 }).done
  void display.set(ID.footer, 'PROPRIETARY SYSTEM')
  let log = ''
  for (const check of checks) {
    log += `> ${check.label}`
    await display.set(ID.body, log + ' ...')
    await sleep(140)
    log += check.ok ? ' ... OK\n' : ' ... MISSING\n'
    await display.set(ID.body, log)
  }
  // Linger on a failed check so it can actually be read.
  await sleep(checks.every((c) => c.ok) ? 300 : 1400)

  // Act 3: EDITH.
  await Promise.all([display.set(ID.body, ' '), display.set(ID.footer, ' ')])
  await typewrite(display, ID.header, 'E.D.I.T.H. // ONLINE', { cps: 50 }).done
  await typewrite(display, ID.body, "EVEN DEAD, I'M THE HERO.", { cps: 45 }).done
  await sleep(700)
  await typewrite(display, ID.body, greeting).done

  // Bluetooth latency on hardware will differ from the simulator; compare here.
  console.log(`[boot] done in ${Math.round(performance.now() - t0)}ms${imagesOk ? '' : ' (no reactor image)'}`)
}
