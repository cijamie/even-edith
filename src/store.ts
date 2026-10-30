import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

/**
 * String key-value storage in the Even app's SDK storage on the phone.
 * Outside the Even app (desktop browser, GitHub Pages) the bridge can't store
 * anything, so it falls back to the browser's localStorage.
 */
export class Store {
  constructor(private bridge: EvenAppBridge | null) {}

  async get(key: string): Promise<string> {
    try {
      const value = await this.bridge?.getLocalStorage(key)
      if (value) return value
    } catch {}
    return safeLocal(() => localStorage.getItem(key)) ?? ''
  }

  async set(key: string, value: string): Promise<void> {
    let saved = false
    try {
      saved = (await this.bridge?.setLocalStorage(key, value)) ?? false
    } catch {}
    // Keep the browser copy in step with the bridge so get() never returns a stale fallback.
    safeLocal(() => (saved ? localStorage.removeItem(key) : localStorage.setItem(key, value)))
  }

  /** Copies values from old keys to new ones where the new key is still empty (for renames). */
  async migrate(renames: Record<string, string>) {
    for (const [from, to] of Object.entries(renames)) {
      if (await this.get(to)) continue
      const value = await this.get(from)
      if (value) await this.set(to, value)
    }
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const raw = await this.get(key)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  setJson(key: string, value: unknown) {
    return this.set(key, JSON.stringify(value))
  }
}

function safeLocal<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
