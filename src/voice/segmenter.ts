import { AudioInputSource, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { rms, toWav } from './recorder'

const RATE = 16000
const QUIET = 0.01 // RMS below this counts as a pause
const SILENT_PEAK = 0.008 // segments never louder than this are dropped

export type Segment = { wav: Blob; seconds: number }

/**
 * Continuous listening that cuts the mic stream into clips at natural pauses,
 * for live captions and meeting recording. A clip is flushed once it's at
 * least `minSeconds` long and the speaker pauses, or at `maxSeconds` regardless.
 * Silent clips are dropped so they don't burn Groq quota.
 */
export class Segmenter {
  private chunks: Uint8Array[] = []
  private bytes = 0
  private peak = 0
  active = false

  constructor(
    private bridge: EvenAppBridge,
    private opts: { minSeconds: number; maxSeconds: number },
    private onSegment: (s: Segment) => void,
    private onLevel: (level: number) => void = () => {},
  ) {}

  async start() {
    this.reset()
    this.active = true
    await this.bridge.audioControl(true, AudioInputSource.Glasses)
  }

  async stop() {
    this.active = false
    await this.bridge.audioControl(false)
    this.flush()
  }

  push(pcm: Uint8Array) {
    if (!this.active) return
    this.chunks.push(pcm)
    this.bytes += pcm.byteLength
    const level = rms(pcm)
    this.peak = Math.max(this.peak, level)
    this.onLevel(Math.min(1, Math.sqrt(level * 5)))
    const seconds = this.bytes / (RATE * 2)
    if ((seconds >= this.opts.minSeconds && level < QUIET) || seconds >= this.opts.maxSeconds) this.flush()
  }

  private flush() {
    const seconds = this.bytes / (RATE * 2)
    if (seconds >= 0.5 && this.peak >= SILENT_PEAK) {
      const pcm = new Uint8Array(this.bytes)
      let offset = 0
      for (const c of this.chunks) {
        pcm.set(c, offset)
        offset += c.byteLength
      }
      this.onSegment({ wav: toWav(pcm), seconds })
    }
    this.reset()
  }

  private reset() {
    this.chunks = []
    this.bytes = 0
    this.peak = 0
  }
}
