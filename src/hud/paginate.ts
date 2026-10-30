import { BODY_LINES, BODY_WIDTH } from './layout'

// Approximate glyph widths in px for the glasses' proportional font, measured
// in the simulator and rounded up. Underestimating is the costly mistake: an
// overflowing page gets a scrollbar and the firmware eats swipes to scroll it.
const AVG = 10
const NARROW = 6
const WIDE = 16
const narrow = new Set(" .,:;'!|il1ijtfr()[]·")
const wide = new Set('MWmw@%─')
const SAFETY = 0.9 // use 90% of the width to absorb estimate error

const widthOf = (s: string) =>
  [...s].reduce((w, c) => w + (narrow.has(c) ? NARROW : wide.has(c) ? WIDE : AVG), 0)

/**
 * Splits text into pages that fit the body container.
 * Wrapping is only estimated here to decide where pages break; the page text
 * keeps its original spacing so the firmware does the actual line wrapping.
 */
export function paginate(text: string, width = BODY_WIDTH * SAFETY, linesPerPage = BODY_LINES): string[] {
  const pages: string[] = []
  let page = ''
  let lines = 0
  for (const para of text.split('\n')) {
    let line = ''
    let lineStart = page.length > 0 && lines > 0 ? '\n' : ''
    let paraText = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && widthOf(next) > width) {
        // Line full: count it, and start a new page if this one is full.
        lines++
        if (lines >= linesPerPage) {
          pages.push(page + lineStart + paraText)
          page = ''
          lineStart = ''
          paraText = ''
          lines = 0
        }
        line = word
      } else {
        line = next
      }
      paraText += (paraText ? ' ' : '') + word
    }
    page += lineStart + paraText
    lines++
    if (lines >= linesPerPage) {
      pages.push(page)
      page = ''
      lines = 0
    }
  }
  if (page) pages.push(page)
  return pages.length ? pages : ['']
}
