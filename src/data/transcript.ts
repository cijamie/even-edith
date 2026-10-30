export type Speaker = 'self' | 'other' | 'unknown'
export type Line = { at: number; text: string; speaker: Speaker }

const KEEP_MS = 30 * 60_000

export const speakerLabel = (s: Speaker) => (s === 'self' ? 'You' : s === 'other' ? 'Them' : '')

/**
 * The last 30 minutes of what captions and meeting mode heard, so
 * "what did they just say?" works after the fact. Memory only: never saved.
 */
export class Transcript {
  private lines: Line[] = []

  add(text: string, speaker: Speaker = 'unknown', at = Date.now()) {
    this.lines.push({ at, text, speaker })
    this.lines = this.lines.filter((l) => l.at > at - KEEP_MS)
  }

  since(ms: number): Line[] {
    return this.lines.filter((l) => l.at >= ms)
  }

  get empty() {
    return !this.lines.length
  }
}
