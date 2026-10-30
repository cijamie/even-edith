import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export type KeyName = 'gemini' | 'groq'

const STORAGE_KEY: Record<KeyName, string> = {
  gemini: 'jarvis.geminiKey',
  groq: 'jarvis.groqKey',
}

// Format checks only; whether a key actually works is tested in the CORS screen.
const PATTERN: Record<KeyName, RegExp> = {
  // Classic keys are AIza…; AI Studio now also issues "auth keys" starting AQ.
  gemini: /^(AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_.-]{20,})$/,
  groq: /^gsk_[0-9A-Za-z]{40,}$/,
}

export const looksValid = (name: KeyName, value: string) => PATTERN[name].test(value)

/** "…abcd" so the UI can confirm which key is saved without showing it. */
export const maskKey = (value: string) => (value ? `…${value.slice(-4)}` : '')

/**
 * API keys live in the Even app's SDK storage on the phone. Outside the Even
 * app (desktop browser, GitHub Pages) the bridge can't store anything, so it
 * falls back to the browser's localStorage.
 */
export class Settings {
  constructor(private bridge: EvenAppBridge | null) {}

  async get(name: KeyName): Promise<string> {
    const key = STORAGE_KEY[name]
    try {
      const value = await this.bridge?.getLocalStorage(key)
      if (value) return value
    } catch {}
    return safeLocal(() => localStorage.getItem(key)) ?? ''
  }

  async set(name: KeyName, value: string): Promise<void> {
    const key = STORAGE_KEY[name]
    let saved = false
    try {
      saved = (await this.bridge?.setLocalStorage(key, value)) ?? false
    } catch {}
    // Keep the browser copy in step with the bridge so get() never returns a stale fallback.
    safeLocal(() => (saved ? localStorage.removeItem(key) : localStorage.setItem(key, value)))
  }

  async all(): Promise<Record<KeyName, string>> {
    const [gemini, groq] = await Promise.all([this.get('gemini'), this.get('groq')])
    return { gemini, groq }
  }
}

function safeLocal<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
