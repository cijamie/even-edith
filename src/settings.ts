import type { Store } from './store'

export type KeyName = 'gemini' | 'groq'

const STORAGE_KEY: Record<KeyName, string> = {
  gemini: 'edith.geminiKey',
  groq: 'edith.groqKey',
}
const HOME_CITY = 'edith.homeCity'

// Format checks only; whether a key actually works is tested in the CORS screen.
const PATTERN: Record<KeyName, RegExp> = {
  // Classic keys are AIza…; AI Studio now also issues "auth keys" starting AQ.
  gemini: /^(AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_.-]{20,})$/,
  groq: /^gsk_[0-9A-Za-z]{40,}$/,
}

export const looksValid = (name: KeyName, value: string) => PATTERN[name].test(value)

/** "…abcd" so the UI can confirm which key is saved without showing it. */
export const maskKey = (value: string) => (value ? `…${value.slice(-4)}` : '')

/** API keys and preferences, kept on the phone. */
export class Settings {
  constructor(private store: Store) {}

  get(name: KeyName): Promise<string> {
    return this.store.get(STORAGE_KEY[name])
  }

  set(name: KeyName, value: string): Promise<void> {
    return this.store.set(STORAGE_KEY[name], value)
  }

  async all(): Promise<Record<KeyName, string>> {
    const [gemini, groq] = await Promise.all([this.get('gemini'), this.get('groq')])
    return { gemini, groq }
  }

  homeCity(): Promise<string> {
    return this.store.get(HOME_CITY)
  }

  setHomeCity(city: string): Promise<void> {
    return this.store.set(HOME_CITY, city)
  }

  /** "HH:MM" for the daily briefing, or '' for off. */
  briefingTime(): Promise<string> {
    return this.store.get('edith.briefingTime')
  }

  setBriefingTime(time: string): Promise<void> {
    return this.store.set('edith.briefingTime', time)
  }

  teleprompter(): Promise<string> {
    return this.store.get('edith.teleprompter')
  }

  setTeleprompter(script: string): Promise<void> {
    return this.store.set('edith.teleprompter', script)
  }

  /** Free-form state the assistant keeps between launches (e.g. last briefing date). */
  getState(key: string): Promise<string> {
    return this.store.get(`edith.state.${key}`)
  }

  setState(key: string, value: string): Promise<void> {
    return this.store.set(`edith.state.${key}`, value)
  }
}
