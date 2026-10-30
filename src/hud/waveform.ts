// All eight render on the glasses font (checked with the ?probe page), ~20px each.
const BARS = '▁▂▃▄▅▆▇█'
const WIDTH = 16

/** Scrolling mic level meter for the footer. */
export class Waveform {
  private levels: number[] = new Array(WIDTH).fill(0)

  reset() {
    this.levels.fill(0)
  }

  push(level: number): string {
    this.levels.push(level)
    this.levels.shift()
    return this.render()
  }

  render(): string {
    return '● ' + this.levels.map((l) => BARS[Math.min(BARS.length - 1, Math.round(l * (BARS.length - 1)))]).join('')
  }
}
