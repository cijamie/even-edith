/** Lowercase words, punctuation dropped (apostrophes kept). */
export const wordsOf = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)

/**
 * Where in the script the speaker has got to: the end of the best match for
 * the words just heard, searching a little behind and well ahead of `cursor`.
 * Never moves backwards; returns `cursor` unchanged when nothing matches well enough.
 */
export function followScript(script: string[], cursor: number, heard: string[]): number {
  const tail = heard.slice(-8)
  if (tail.length < 2) return cursor
  let best = { score: 0, end: cursor }
  const from = Math.max(0, cursor - 10)
  const to = Math.min(script.length, cursor + 120)
  for (let end = from + 1; end <= to; end++) {
    // Count heard words found, in order, in the window ending at `end`.
    const window = script.slice(Math.max(0, end - tail.length - 4), end)
    let i = 0
    let score = 0
    for (const w of tail) {
      const at = window.indexOf(w, i)
      if (at >= 0) {
        score++
        i = at + 1
      }
    }
    // Ties go to the nearer position, so repeated phrases don't jump ahead.
    if (score > best.score) best = { score, end }
  }
  return best.score >= Math.max(2, Math.ceil(tail.length * 0.5)) ? Math.max(cursor, best.end) : cursor
}
