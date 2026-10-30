import { requestJson } from './http'
import type { Store } from '../store'

const BASE = 'https://api.groq.com/openai/v1/audio'

/** Speech to text with Groq's hosted Whisper. `translate` returns English whatever the spoken language. */
export async function transcribe(wav: Blob, key: string, { translate = false } = {}): Promise<string> {
  const form = new FormData()
  form.append('file', wav, 'speech.wav')
  // Translation needs full large-v3; turbo only transcribes.
  form.append('model', translate ? 'whisper-large-v3' : 'whisper-large-v3-turbo')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const body = await requestJson<{ text?: string }>(
    `${BASE}/${translate ? 'translations' : 'transcriptions'}`,
    { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
    20000,
  )
  return (body.text ?? '').trim()
}

// Whisper's stock output for near-silence or noise.
const HALLUCINATIONS = new Set(['', 'you', 'thank you', 'thanks for watching', 'bye', '.', 'thank you for watching'])

export const isNoise = (text: string) => HALLUCINATIONS.has(text.toLowerCase().replace(/[.!?,\s]+$/g, ''))

// Groq free-tier speech-to-text limits (per their published rate limits at the time of writing).
export const GROQ_FREE = { requestsPerDay: 2000, audioSecondsPerDay: 28800, requestsPerMinute: 20 }

/** Counts today's Groq usage so long-running modes can warn before the free tier runs out. */
export class GroqUsage {
  private day = ''
  requests = 0
  seconds = 0

  constructor(private store: Store) {}

  async load() {
    const saved = await this.store.getJson<{ day: string; requests: number; seconds: number }>('edith.groqUsage', {
      day: '',
      requests: 0,
      seconds: 0,
    })
    Object.assign(this, saved)
    this.rollover()
  }

  async add(seconds: number) {
    this.rollover()
    this.requests++
    this.seconds += seconds
    await this.store.setJson('edith.groqUsage', { day: this.day, requests: this.requests, seconds: this.seconds })
  }

  /** 0..1 of the tighter daily limit. */
  get fraction() {
    this.rollover()
    return Math.max(this.requests / GROQ_FREE.requestsPerDay, this.seconds / GROQ_FREE.audioSecondsPerDay)
  }

  private rollover() {
    const today = new Date().toDateString()
    if (this.day !== today) Object.assign(this, { day: today, requests: 0, seconds: 0 })
  }
}
