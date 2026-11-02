import type { AudioSpeakerRole, EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Agenda } from '../data/agenda'
import type { Lists } from '../data/lists'
import type { Pins } from '../data/pins'
import type { Decks } from '../data/decks'
import type { Transcript } from '../data/transcript'
import type { Locator } from '../geo/location'
import type { Display } from '../hud/display'
import type { Brain } from '../net/gemini'
import type { GroqUsage } from '../net/groq'
import type { Settings } from '../settings'
import type { Action } from '../tools'

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
  audio?(pcm: Uint8Array, role?: AudioSpeakerRole): void
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
  lists: Lists
  transcript: Transcript
  pins: Pins
  decks: Decks
  /** Status lines for the diagnostics screen. */
  diagnostics(): Promise<string[]>
  /** Leave the mode and show `text` as Jarvis's reply (header defaults to the banner). */
  finish(text: string, header?: string): Promise<void>
  /** Leave this mode for another view or mode (e.g. emergency → navigation). */
  run(action: Action): Promise<void>
}
