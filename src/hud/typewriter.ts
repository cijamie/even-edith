import type { Display } from './display'

export type Typing = {
  /** Resolves when the full text is on screen (typed out or skipped). */
  done: Promise<void>
  /** Jump straight to the full text. */
  skip(): void
}

const CURSOR = '_'
const FRAME_MS = 50

/**
 * Reveals `text` in a container a few characters per frame.
 * Each frame waits for the previous update to reach the glasses, so a slow
 * Bluetooth link reveals bigger chunks instead of falling behind.
 */
export function typewrite(
  display: Display,
  containerID: number,
  text: string,
  { cps = 90, prefix = '' }: { cps?: number; prefix?: string } = {},
): Typing {
  let skipped = false
  const done = (async () => {
    const start = performance.now()
    let shown = 0
    while (shown < text.length && !skipped) {
      const frame = performance.now()
      shown = Math.min(text.length, Math.max(shown + 1, Math.floor(((frame - start) / 1000) * cps)))
      await display.set(containerID, prefix + text.slice(0, shown) + CURSOR)
      const wait = FRAME_MS - (performance.now() - frame)
      if (wait > 0) await sleep(wait)
    }
    await display.set(containerID, prefix + text)
  })()
  return {
    done,
    skip: () => {
      skipped = true
    },
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
