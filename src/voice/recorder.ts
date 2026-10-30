import { AudioInputSource, type EvenAppBridge } from '@evenrealities/even_hub_sdk'

const RATE = 16000
const MAX_SECONDS = 30

/**
 * Collects the glasses' mic stream (16 kHz, signed 16-bit LE, mono, ~100 ms
 * chunks arriving on event.audioEvent) between start() and stop().
 */
export class Recorder {
  private chunks: Uint8Array[] = []
  private bytes = 0
  private peak = 0
  recording = false

  constructor(
    private bridge: EvenAppBridge,
    /** Called per chunk with its loudness, 0..1. */
    private onLevel: (level: number) => void = () => {},
  ) {}

  async start() {
    this.chunks = []
    this.bytes = 0
    this.peak = 0
    this.recording = true
    await this.bridge.audioControl(true, AudioInputSource.Glasses)
  }

  /** Feed from onEvenHubEvent. */
  push(pcm: Uint8Array) {
    if (!this.recording || this.bytes >= RATE * 2 * MAX_SECONDS) return
    this.chunks.push(pcm)
    this.bytes += pcm.byteLength
    const level = rms(pcm)
    this.peak = Math.max(this.peak, level)
    // Square-root curve so quiet speech still moves the meter.
    this.onLevel(Math.min(1, Math.sqrt(level * 5)))
  }

  async stop(): Promise<{ wav: Blob; seconds: number; peak: number }> {
    this.recording = false
    await this.bridge.audioControl(false)
    const pcm = new Uint8Array(this.bytes)
    let offset = 0
    for (const c of this.chunks) {
      pcm.set(c, offset)
      offset += c.byteLength
    }
    this.chunks = []
    return { wav: toWav(pcm), seconds: this.bytes / (RATE * 2), peak: this.peak }
  }
}

/** RMS loudness of a PCM chunk, 0..1 (a quiet room is ~0.005, speech ~0.03-0.2). */
export function rms(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const n = Math.floor(pcm.byteLength / 2)
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true) / 32768
    sum += s * s
  }
  return Math.sqrt(sum / n)
}

export function toWav(pcm: Uint8Array, rate = RATE): Blob {
  const header = new DataView(new ArrayBuffer(44))
  const str = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  header.setUint32(4, 36 + pcm.byteLength, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, rate, true)
  header.setUint32(28, rate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  str(36, 'data')
  header.setUint32(40, pcm.byteLength, true)
  return new Blob([header.buffer, pcm as BlobPart], { type: 'audio/wav' })
}
