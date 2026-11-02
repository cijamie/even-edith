import type { Speaker } from '../data/transcript'

export type Said = { text: string; seconds: number; speaker: Speaker }

// "like" and "so" are only fillers some of the time; counting them anyway
// keeps it simple and errs on the side of a nudge.
const FILLERS = ['um', 'uh', 'erm', 'er', 'ah', 'like', 'you know', 'i mean', 'basically', 'actually', 'literally', 'sort of', 'kind of']

/**
 * Speaking stats from a meeting: words per minute, filler words, and how much
 * of the talking you did (when the Even app labels who's speaking).
 */
export function coach(said: Said[]): string {
  const yours = said.filter((s) => s.speaker === 'self')
  const labelled = said.some((s) => s.speaker !== 'unknown')
  // Without labels, everything counts as yours (often true for a talk or call).
  const mine = labelled ? yours : said
  const seconds = mine.reduce((n, s) => n + s.seconds, 0)
  if (seconds < 20) return ''
  const text = ' ' + mine.map((s) => s.text.toLowerCase().replace(/[^\p{L}\s']/gu, ' ')).join(' ') + ' '
  const words = text.split(/\s+/).filter(Boolean).length
  // Lookarounds so back-to-back fillers ("um um") both count.
  const counts = FILLERS.map((f) => [f, (text.match(new RegExp(`(?<=\\s)${f}(?=\\s)`, 'g')) ?? []).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  const fillers = counts.reduce((n, [, c]) => n + c, 0)
  const wpm = Math.round(words / (seconds / 60))
  const pace = wpm > 170 ? ' (fast)' : wpm < 110 ? ' (slow)' : ''
  const parts = [`${wpm} words a minute${pace}`]
  parts.push(fillers ? `${fillers} filler${fillers > 1 ? 's' : ''} (${counts.slice(0, 3).map(([f, n]) => `${f} ×${n}`).join(', ')})` : 'no fillers')
  if (labelled) {
    const total = said.reduce((n, s) => n + s.seconds, 0)
    parts.unshift(`You talked ${Math.round((seconds / total) * 100)}% of the time`)
  }
  return `Coach: ${parts.join(', ')}.`
}
