import type { Agenda } from '../data/agenda'
import type { Memory } from '../data/memory'
import type { Locator } from '../geo/location'
import type { Settings } from '../settings'
import { localIso, spokenDuration } from '../util/time'
import { currencyDeclaration, convertCurrency } from './currency'
import { getWeather, weatherAt, weatherDeclaration } from './weather'
import { webLookup } from './web'

export const PROTOCOLS = ['standard', 'focus', 'night', 'stealth'] as const
export type Protocol = (typeof PROTOCOLS)[number]

/** Things a tool can ask the HUD to do once the reply is ready. */
export type Action =
  | { type: 'dashboard' }
  | { type: 'map' }
  | { type: 'radar'; category: string }
  | { type: 'captions'; translate: boolean }
  | { type: 'meeting' }
  | { type: 'teleprompter' }
  | { type: 'briefing' }
  | { type: 'protocol'; name: Protocol; minutes?: number }

/** What the tools can touch. */
export type ToolContext = {
  agenda: Agenda
  memory: Memory
  settings: Settings
  locator: Locator
  /** Glasses battery etc., filled in from the SDK. */
  deviceStatus: () => Record<string, unknown>
  actions: Action[]
}

type Tool = { declaration: object; run: (args: any, ctx: ToolContext) => Promise<unknown> }

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required })
const str = (description: string) => ({ type: 'string', description })
const TIME = str('Local date-time, ISO 8601 without timezone, e.g. 2026-10-30T15:00:00')

/** Parses Gemini's local ISO time; refuses nonsense rather than storing NaN. */
function parseTime(value: string): number {
  const ms = new Date(value).getTime()
  if (Number.isNaN(ms)) throw new Error(`Could not understand the time "${value}".`)
  return ms
}

/** A tool that only switches the HUD to a view. */
const view = (name: string, description: string, action: (args: any) => Action, parameters = obj({})): Tool => ({
  declaration: { name, description, parameters },
  async run(args, { actions }) {
    actions.push(action(args))
    return { opened: true, note: 'Reply with a very short acknowledgement only.' }
  },
})

export const RADAR_CATEGORIES: Record<string, string> = {
  cafe: 'amenity:cafe',
  restaurant: 'amenity:restaurant',
  pub: 'amenity:pub',
  pharmacy: 'amenity:pharmacy',
  atm: 'amenity:atm',
  toilets: 'amenity:toilets',
  fuel: 'amenity:fuel',
  parking: 'amenity:parking',
  supermarket: 'shop:supermarket',
  bus_stop: 'highway:bus_stop',
  station: 'railway:station',
  hotel: 'tourism:hotel',
}

const tools: Record<string, Tool> = {
  get_weather: {
    declaration: {
      ...weatherDeclaration,
      parameters: obj({ location: str("Place name. Omit for the user's current location (or home city).") }),
    },
    async run({ location }, { settings, locator }) {
      if (location) return getWeather({ location })
      const fix = await locator.get(10 * 60_000)
      if (fix && fix.source !== 'home') return weatherAt(fix.lat, fix.lon, 'current location')
      const home = await settings.homeCity()
      if (home) return getWeather({ location: home })
      return { error: 'No location available and no home city set. Ask which city.' }
    },
  },

  convert_currency: { declaration: currencyDeclaration, run: (args) => convertCurrency(args) },

  web_lookup: {
    declaration: {
      name: 'web_lookup',
      description:
        'Look something up on Wikipedia and DuckDuckGo instant answers. Use for facts you are unsure of, people, places, ' +
        'definitions and anything after your training. It is not a live news feed.',
      parameters: obj({ query: str('Search query') }, ['query']),
    },
    run: (args) => webLookup(args),
  },

  remember: {
    declaration: {
      name: 'remember',
      description: 'Store a long-term fact about the user or something they want remembered (e.g. "parked on level 3", "allergic to peanuts").',
      parameters: obj({ fact: str('The fact, phrased in third person or as a short statement') }, ['fact']),
    },
    async run({ fact }, { memory }) {
      const f = await memory.add(fact)
      return { remembered: f.text, id: f.id }
    },
  },

  forget: {
    declaration: {
      name: 'forget',
      description: 'Forget a stored fact by its id (ids are shown in brackets in your memory list).',
      parameters: obj({ id: str('Fact id') }, ['id']),
    },
    async run({ id }, { memory }) {
      return { forgotten: await memory.remove(id) }
    },
  },

  device_status: {
    declaration: { name: 'device_status', description: 'Glasses battery, charging and wearing status.', parameters: obj({}) },
    async run(_args, { deviceStatus }) {
      return deviceStatus()
    },
  },

  open_dashboard: view(
    'open_dashboard',
    'Show the dashboard (time, weather, timers, reminders, calendar, latest note, battery). Use for "open dashboard" or an overview of the day.',
    () => ({ type: 'dashboard' }),
  ),
  open_map: view('open_map', 'Show a map of where the user is right now, from the phone location.', () => ({ type: 'map' })),
  open_radar: view(
    'open_radar',
    `Radar of nearby places of one type, with distance and direction. Categories: ${Object.keys(RADAR_CATEGORIES).join(', ')}.`,
    ({ category }) => ({ type: 'radar', category: RADAR_CATEGORIES[category] ? category : 'cafe' }),
    obj({ category: { type: 'string', enum: Object.keys(RADAR_CATEGORIES) } }, ['category']),
  ),
  start_captions: view(
    'start_captions',
    'Live captions of what people nearby are saying. translate=true translates any language into English.',
    ({ translate }) => ({ type: 'captions', translate: !!translate }),
    obj({ translate: { type: 'boolean' } }),
  ),
  start_meeting: view(
    'start_meeting',
    'Record a meeting or conversation; when stopped, it is transcribed and summarised into a note with action items.',
    () => ({ type: 'meeting' }),
  ),
  open_teleprompter: view('open_teleprompter', 'Show the teleprompter script saved in the phone app, paged with swipes.', () => ({
    type: 'teleprompter',
  })),
  briefing: view('briefing', 'Give the daily briefing (weather, schedule, reminders).', () => ({ type: 'briefing' })),
  set_protocol: view(
    'set_protocol',
    'Switch protocol. focus: Pomodoro countdown (default 25 min) with nudges held back. night: dim display. ' +
      'stealth: minimal display, chrome hidden. standard: back to normal.',
    ({ name, minutes }) => ({ type: 'protocol', name: PROTOCOLS.includes(name) ? name : 'standard', minutes }),
    obj({ name: { type: 'string', enum: [...PROTOCOLS] }, minutes: { type: 'integer', description: 'Focus length' } }, ['name']),
  ),

  set_timer: {
    declaration: {
      name: 'set_timer',
      description: 'Start a countdown timer.',
      parameters: obj(
        {
          seconds: { type: 'integer', description: 'Total duration in seconds.' },
          label: str('Short name, e.g. "pasta". Default "timer".'),
        },
        ['seconds'],
      ),
    },
    async run({ seconds, label }, { agenda }) {
      if (!(seconds > 0) || seconds > 86400) return { error: 'Timers must be between 1 second and 24 hours.' }
      const t = await agenda.addTimer(Math.round(seconds), (label || 'timer').toLowerCase())
      return { started: t.label, duration: spokenDuration(t.seconds), endsAt: localIso(t.endsAt) }
    },
  },

  list_timers: {
    declaration: { name: 'list_timers', description: 'List running timers.', parameters: obj({}) },
    async run(_args, { agenda }) {
      return agenda.timers.map((t) => ({
        id: t.id,
        label: t.label,
        remaining: spokenDuration((t.endsAt - Date.now()) / 1000),
      }))
    },
  },

  cancel_timer: {
    declaration: {
      name: 'cancel_timer',
      description: 'Cancel timers by id or label. With neither, cancels all timers.',
      parameters: obj({ id: str('Timer id from list_timers'), label: str('Timer label') }),
    },
    async run({ id, label }, { agenda }) {
      const ids = agenda.timers
        .filter((t) => (id ? t.id === id : label ? t.label === String(label).toLowerCase() : true))
        .map((t) => t.id)
      return { cancelled: await agenda.remove('timers', ids) }
    },
  },

  add_reminder: {
    declaration: {
      name: 'add_reminder',
      description: 'Remind the user about something at a time. The glasses show it when due.',
      parameters: obj({ text: str('What to remind about'), time: TIME }, ['text', 'time']),
    },
    async run({ text, time }, { agenda }) {
      const at = parseTime(time)
      if (at < Date.now() - 60000) return { error: 'That time has already passed.' }
      const r = await agenda.addReminder(text, at)
      return { saved: r.text, at: localIso(r.at) }
    },
  },

  list_reminders: {
    declaration: { name: 'list_reminders', description: 'List upcoming reminders.', parameters: obj({}) },
    async run(_args, { agenda }) {
      return agenda.reminders.map((r) => ({ id: r.id, text: r.text, at: localIso(r.at) }))
    },
  },

  delete_reminder: {
    declaration: {
      name: 'delete_reminder',
      description: 'Delete a reminder by id (call list_reminders first to find it).',
      parameters: obj({ id: str('Reminder id') }, ['id']),
    },
    async run({ id }, { agenda }) {
      return { deleted: await agenda.remove('reminders', [id]) }
    },
  },

  add_event: {
    declaration: {
      name: 'add_event',
      description: "Add an event to the user's EDITH calendar (stored on the phone).",
      parameters: obj({ title: str('Event title'), start: TIME, end: TIME }, ['title', 'start']),
    },
    async run({ title, start, end }, { agenda }) {
      const e = await agenda.addEvent(title, parseTime(start), end ? parseTime(end) : undefined)
      return { saved: e.title, start: localIso(e.start), end: e.end ? localIso(e.end) : undefined }
    },
  },

  list_events: {
    declaration: {
      name: 'list_events',
      description: 'List calendar events between two times (default: now to 7 days ahead).',
      parameters: obj({ from: TIME, to: TIME }),
    },
    async run({ from, to }, { agenda }) {
      const a = from ? parseTime(from) : Date.now() - 3600_000
      const b = to ? parseTime(to) : Date.now() + 7 * 86400_000
      return agenda.events
        .filter((e) => e.start >= a && e.start <= b)
        .map((e) => ({ id: e.id, title: e.title, start: localIso(e.start), end: e.end ? localIso(e.end) : undefined }))
    },
  },

  delete_event: {
    declaration: {
      name: 'delete_event',
      description: 'Delete a calendar event by id (call list_events first to find it).',
      parameters: obj({ id: str('Event id') }, ['id']),
    },
    async run({ id }, { agenda }) {
      return { deleted: await agenda.remove('events', [id]) }
    },
  },

  add_note: {
    declaration: {
      name: 'add_note',
      description: 'Save a note for the user (shopping items, ideas, things to remember).',
      parameters: obj({ text: str('The note') }, ['text']),
    },
    async run({ text }, { agenda }) {
      const n = await agenda.addNote(text)
      return { saved: n.text }
    },
  },

  list_notes: {
    declaration: { name: 'list_notes', description: 'List saved notes, newest first.', parameters: obj({}) },
    async run(_args, { agenda }) {
      return agenda.notes.slice(0, 20).map((n) => ({ id: n.id, text: n.text, saved: localIso(n.createdAt) }))
    },
  },

  delete_note: {
    declaration: {
      name: 'delete_note',
      description: 'Delete a note by id (call list_notes first to find it).',
      parameters: obj({ id: str('Note id') }, ['id']),
    },
    async run({ id }, { agenda }) {
      return { deleted: await agenda.remove('notes', [id]) }
    },
  },
}

export const declarations = Object.values(tools).map((t) => t.declaration)

export async function runTool(name: string, args: any, ctx: ToolContext): Promise<unknown> {
  const tool = tools[name]
  if (!tool) return { error: `Unknown tool ${name}` }
  try {
    return await tool.run(args ?? {}, ctx)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
