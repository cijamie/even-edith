import type { Display } from './display'
import { GLYPHS, ID } from './layout'
import { sleep, typewrite } from './typewriter'

export type Check = { label: string; ok: boolean }

/** ~2 s boot: brackets draw in, systems check, then the ONLINE banner. */
export async function boot(display: Display, checks: Check[], greeting: string) {
  const t0 = performance.now()

  // Brackets draw in one glyph per frame.
  for (let n = 1; n <= 3; n++) {
    await Promise.all([
      display.set(ID.tl, GLYPHS.tl.slice(0, n)),
      display.set(ID.bl, GLYPHS.bl.slice(0, n)),
      display.set(ID.tr, GLYPHS.tr.slice(0, n)),
      display.set(ID.br, GLYPHS.br.slice(0, n)),
    ])
    await sleep(80)
  }

  await typewrite(display, ID.header, 'INITIALISING...', { cps: 60 }).done

  let log = ''
  for (const check of checks) {
    log += `> ${check.label}`
    await display.set(ID.body, log + ' ...')
    await sleep(150)
    log += check.ok ? ' ... OK\n' : ' ... MISSING\n'
    await display.set(ID.body, log)
  }
  // Linger on a failed check so it can actually be read.
  await sleep(checks.every((c) => c.ok) ? 150 : 1200)

  await display.set(ID.body, ' ')
  await typewrite(display, ID.header, 'J.A.R.V.I.S // ONLINE', { cps: 70 }).done
  await typewrite(display, ID.body, greeting).done

  // Bluetooth latency on hardware will differ from the simulator; compare here.
  console.log(`[boot] done in ${Math.round(performance.now() - t0)}ms`)
}
