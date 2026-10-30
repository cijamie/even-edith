import type { Settings } from '../settings'
import { toWav } from '../voice/recorder'

export type Result = {
  ok: boolean
  /** Short verdict for the UI, e.g. "OK", "BLOCKED", "BAD KEY". */
  verdict: string
  detail: string
  ms: number
}

export type Check = {
  id: string
  label: string
  run: (settings: Settings) => Promise<Omit<Result, 'ms'>>
}

const GROQ = 'https://api.groq.com/openai/v1'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'
const METEO = 'https://api.open-meteo.com/v1'

/**
 * Wraps fetch so failures say *why*:
 * - fetch throws (TypeError)  -> the request never got a readable response:
 *   CORS rejected it, the Even app whitelist blocked it, or there's no network.
 * - HTTP 401/403              -> CORS is fine, the key is wrong.
 * - HTTP 429                  -> CORS and key fine, rate limited.
 */
async function call(url: string, init: RequestInit = {}): Promise<Omit<Result, 'ms'> & { body?: any }> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  } catch (err) {
    const timeout = err instanceof DOMException && err.name === 'TimeoutError'
    return {
      ok: false,
      verdict: timeout ? 'TIMEOUT' : 'BLOCKED',
      detail: timeout
        ? 'No reply in 15 s.'
        : 'No readable response: blocked by CORS, by the app.json whitelist, or no network.',
    }
  }
  let body: any = null
  try {
    body = await res.json()
  } catch {}
  if (res.ok) return { ok: true, verdict: 'OK', detail: `HTTP ${res.status}`, body }
  const message = body?.error?.message ?? body?.error ?? res.statusText
  const verdict =
    res.status === 401 || res.status === 403
      ? 'BAD KEY'
      : res.status === 429
        ? 'RATE LIMIT'
        : `HTTP ${res.status}`
  return { ok: false, verdict, detail: `Reached the server (CORS OK). ${String(message).slice(0, 160)}` }
}

const needKey = { ok: false, verdict: 'NO KEY', detail: 'Add the key above first.' }

/** One second of 16 kHz mono silence, so the real Whisper upload path gets exercised. */
const silentWav = () => toWav(new Uint8Array(16000 * 2))

/**
 * Picks the model for answers. Flash-Lite first: measured on the free tier it
 * answers in ~1 s, while full Flash took 3-4 s or hung past 30 s.
 */
export function pickFlashModel(models: { name: string; supportedGenerationMethods?: string[] }[]) {
  const names = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
  for (const alias of ['gemini-flash-lite-latest', 'gemini-flash-latest']) {
    if (names.includes(alias)) return alias
  }
  const flash = names
    .filter((n) => /^gemini-[\d.]+-flash$/.test(n))
    .sort((a, b) => parseFloat(b.slice(7)) - parseFloat(a.slice(7)))
  return flash[0] ?? names.find((n) => n.includes('flash')) ?? null
}

let geminiModel: string | null = null

export const CHECKS: Check[] = [
  {
    id: 'groq-key',
    label: 'Groq · key and CORS',
    async run(settings) {
      const key = await settings.get('groq')
      if (!key) return needKey
      return call(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key}` } })
    },
  },
  {
    id: 'groq-whisper',
    label: 'Groq · Whisper upload',
    async run(settings) {
      const key = await settings.get('groq')
      if (!key) return needKey
      const form = new FormData()
      form.append('file', silentWav(), 'probe.wav')
      form.append('model', 'whisper-large-v3-turbo')
      const r = await call(`${GROQ}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      })
      return r.ok ? { ...r, detail: 'Transcribed 1 s of silence.' } : r
    },
  },
  {
    id: 'gemini-key',
    label: 'Gemini · key and CORS',
    async run(settings) {
      const key = await settings.get('gemini')
      if (!key) return needKey
      const r = await call(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } })
      if (!r.ok) return r
      geminiModel = pickFlashModel(r.body?.models ?? [])
      return geminiModel
        ? { ...r, detail: `Using ${geminiModel}` }
        : { ok: false, verdict: 'NO MODEL', detail: 'No Flash model available to this key.' }
    },
  },
  {
    id: 'gemini-generate',
    label: 'Gemini · answer a question',
    async run(settings) {
      const key = await settings.get('gemini')
      if (!key) return needKey
      if (!geminiModel) return { ok: false, verdict: 'SKIPPED', detail: 'Needs the key check to pass.' }
      const r = await call(`${GEMINI}/models/${geminiModel}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: Systems nominal.' }] }],
          // Generous cap: "thinking" models spend tokens before answering.
          generationConfig: { maxOutputTokens: 256 },
        }),
      })
      if (!r.ok) return r
      const text = r.body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
      return { ...r, detail: `Said: “${text.trim().slice(0, 60)}”` }
    },
  },
  {
    id: 'meteo',
    label: 'Open-Meteo · weather',
    async run() {
      const r = await call(`${METEO}/forecast?latitude=51.51&longitude=-0.13&current=temperature_2m`)
      if (!r.ok) return r
      return { ...r, detail: `London is ${r.body?.current?.temperature_2m}°C right now.` }
    },
  },
  {
    id: 'geocode',
    label: 'Open-Meteo · place search',
    async run() {
      const r = await call('https://geocoding-api.open-meteo.com/v1/search?count=1&name=Paris')
      if (!r.ok) return r
      const p = r.body?.results?.[0]
      return { ...r, detail: p ? `Found ${p.name}, ${p.country}.` : 'No results.' }
    },
  },
]

export async function runCheck(check: Check, settings: Settings): Promise<Result> {
  const t0 = performance.now()
  const r = await check.run(settings)
  return { ok: r.ok, verdict: r.verdict, detail: r.detail, ms: Math.round(performance.now() - t0) }
}
