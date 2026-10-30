import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Agenda } from '../data/agenda'
import type { Locator } from '../geo/location'
import type { Display } from '../hud/display'
import type { Brain } from '../net/gemini'
import type { GroqUsage } from '../net/groq'
import type { Settings } from '../settings'

/**
 * A full-screen activity (captions, map, teleprompter...). The assistant
 * routes input to the active mode; a press closes it unless the mode handles it.
 */
export interface Mode {
  readonly name: string
  enter(): Promise<void>
  exit(): Promise<void>
  /** Return true if handled; otherwise a press closes the mode. */
  press?(): boolean
  swipe?(dir: 1 | -1): void
  audio?(pcm: Uint8Array): void
  /** Once a second while active. */
  tick?(): void
}

/** What modes get from the assistant. */
export type Host = {
  bridge: EvenAppBridge
  display: Display
  settings: Settings
  agenda: Agenda
  brain: Brain
  locator: Locator
  usage: GroqUsage
  /** Leave the mode and show `text` as EDITH's reply (header defaults to the banner). */
  finish(text: string, header?: string): Promise<void>
}
