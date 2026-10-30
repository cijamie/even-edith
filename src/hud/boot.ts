import { ImageRawDataUpdate, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Display } from './display'
import { GLYPHS, ID, REACTOR, removeReactor } from './layout'
import { REACTOR_FRAMES, reactorFrame } from './reactor'
import { sleep, typewrite } from './typewriter'

export type Check = { label: string; ok: boolean }

const POWER = '▁▂▃▄▅▆▇█'
// Body line where the tagline sits, below the reactor image.
const UNDER_REACTOR = '\n'.repeat(6)

/**
 * Stark Industries boot, ~4 s:
 * brackets draw in → STARK INDUSTRIES → systems check → arc reactor spins up
 * with a power bar → "EVEN DEAD, I'M THE HERO" → E.D.I.T.H. // ONLINE.
 */
export async function boot(bridge: EvenAppBridge, display: Display, checks: Check[], greeting: string) {
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

  await typewrite(display, ID.header, 'STARK INDUSTRIES', { cps: 40 }).done
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
  await sleep(checks.every((c) => c.ok) ? 200 : 1400)
  await display.set(ID.body, ' ')

  // Arc reactor spin-up, with a power bar filling in the header.
  let imagesOk = true
  for (let n = 0; n < REACTOR_FRAMES && imagesOk; n++) {
    const bars = Math.round(((n + 1) / REACTOR_FRAMES) * POWER.length)
    void display.set(ID.header, `ARC REACTOR  ${POWER.slice(0, bars)}`)
    imagesOk = await sendImage(bridge, await reactorFrame(n))
    await sleep(120)
  }
  void display.set(ID.footer, ' ')
  await typewrite(display, ID.body, "EVEN DEAD, I'M THE HERO.", { cps: 45, prefix: UNDER_REACTOR }).done
  await sleep(500)

  // Rebuild without the image container; brackets stay, everything else starts blank.
  const kept = await removeReactor(bridge, { [ID.tl]: GLYPHS.tl, [ID.tr]: GLYPHS.tr, [ID.bl]: GLYPHS.bl, [ID.br]: GLYPHS.br })
  if (!kept) console.warn('[boot] rebuild without reactor failed')
  await typewrite(display, ID.header, 'E.D.I.T.H. // ONLINE', { cps: 60 }).done
  await typewrite(display, ID.body, greeting).done

  // Bluetooth latency on hardware will differ from the simulator; compare here.
  console.log(`[boot] done in ${Math.round(performance.now() - t0)}ms${imagesOk ? '' : ' (no reactor image)'}`)
}

/** Sends one frame; false means skip the rest of the image animation (text boot still runs). */
async function sendImage(bridge: EvenAppBridge, png: Uint8Array): Promise<boolean> {
  try {
    const result = await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: ID.reactor, containerName: REACTOR.name, imageData: png }),
    )
    if (String(result) === 'success') return true
    console.warn('[boot] reactor frame rejected:', result)
  } catch (err) {
    console.warn('[boot] reactor frame failed:', err)
  }
  return false
}
