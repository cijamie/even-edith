import type { Agenda } from '../data/agenda'
import type { Memory } from '../data/memory'
import type { Lists } from '../data/lists'
import type { Transcript } from '../data/transcript'
import { speakerLabel } from '../data/transcript'
import type { GoogleCalendar } from '../data/gcal'
import type { Locator } from '../geo/location'
import type { Settings } from '../settings'
import { localIso, spokenDuration } from '../util/time'
import { currencyDeclaration, convertCurrency } from './currency'
import { getWeather, weatherAt, weatherDeclaration } from './weather'
import { webLookup } from './web'
import { convertUnits, evaluate, fmt, tipSplit } from './calc'
import { cryptoPrice, departures, LEAGUES, scores } from './live'
import { PERSONA_IDS, type PersonaId } from '../persona'

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
  | { type: 'navigate'; query?: string; category?: string }
  | { type: 'guide'; topic?: string }
  | { type: 'list'; name: string }
  | { type: 'activity'; kind: Activity }
  | { type: 'diagnostics' }
  | { type: 'handsfree'; on: boolean }
  | { type: 'persona'; id: PersonaId }
  | { type: 'easter'; id: string }

export const ACTIVITIES = ['walk', 'run', 'ride'] as const
export type Activity = (typeof ACTIVITIES)[number]

/** What the tools can touch. */
export type ToolContext = {
  agenda: Agenda
  memory: Memory
  settings: Settings
  locator: Locator
  lists: Lists
  transcript: Transcript
  calendar: GoogleCalendar
  /** Google Search grounding through Gemini. */
  search: (query: string) => Promise<{ answer: string; sources: string[] }>
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

  web_search: {
    declaration: {
      name: 'web_search',
      description:
        'Search the web with Google. Use for news, current events, live prices and stock quotes, flight status, ' +
        'opening hours, recent results, people, and any fact you are unsure of or that may have changed since training. ' +
        'Write the query as a full question with any place or date that matters.',
      parameters: obj({ query: str('The question to search for') }, ['query']),
    },
    async run({ query }, { search }) {
      try {
        const r = await search(query)
        if (r.answer) return r
      } catch (err) {
        console.warn('[search] grounding failed, falling back to Wikipedia', err)
      }
      // Google Search grounding has a daily free quota; Wikipedia keeps facts working past it.
      return { ...(await webLookup({ query })), note: 'Google search unavailable; these are Wikipedia/DuckDuckGo results, not live.' }
    },
  },

  recall_conversation: {
    declaration: {
      name: 'recall_conversation',
      description:
        'What people said recently while captions, translation or meeting mode were running (last 30 minutes, with "You"/"Them" ' +
        'labels when known). Use for "what did they just say", "what was that name", "summarise the conversation".',
      parameters: obj({ minutes: { type: 'number', description: 'How far back, default 3.' } }),
    },
    async run({ minutes }, { transcript }) {
      const lines = transcript.since(Date.now() - Math.min(30, Math.max(0.5, Number(minutes) || 3)) * 60_000)
      if (!lines.length) {
        return { error: transcript.empty ? 'Nothing captured. Conversations are only heard while captions or meeting mode run.' : 'Nothing said in that window.' }
      }
      return lines.map((l) => `${clockOf(l.at)} ${speakerLabel(l.speaker) ? speakerLabel(l.speaker) + ': ' : ''}${l.text}`).join('\n')
    },
  },

  calculate: {
    declaration: {
      name: 'calculate',
      description: 'Exact arithmetic: + - * / ^ ( ) sqrt and percentages, e.g. "17.5% of 240", "(12+8)*3". Also tips and bill splits.',
      parameters: obj({
        expression: str('Arithmetic expression. Omit for a tip or split.'),
        amount: { type: 'number', description: 'Bill amount, for tip/split' },
        tipPercent: { type: 'number' },
        people: { type: 'number' },
      }),
    },
    async run({ expression, amount, tipPercent, people }) {
      if (amount != null) return tipSplit({ amount, tipPercent, people })
      return { result: fmt(evaluate(String(expression ?? ''))) }
    },
  },

  convert_units: {
    declaration: {
      name: 'convert_units',
      description: 'Convert length, weight, volume, cooking measures, speed, area, data size, time or temperature.',
      parameters: obj({ value: { type: 'number' }, from: str('Unit, e.g. "miles", "lb", "cups", "fahrenheit"'), to: str('Unit') }, ['value', 'from', 'to']),
    },
    run: async (args) => convertUnits(args),
  },

  transit_departures: {
    declaration: {
      name: 'transit_departures',
      description: 'Next buses, trains, trams, tubes or ferries from the stations nearest the user (timetable, real-time where available).',
      parameters: obj({ stop: str('Optional stop or station name nearby'), mode: str('Optional: bus, rail, subway, tram, ferry') }),
    },
    async run({ stop, mode }, { locator }) {
      const fix = await locator.get(60_000)
      if (!fix || fix.source === 'home') return { error: 'I need the phone location for nearby departures.' }
      return departures(fix, { stop, mode })
    },
  },

  sports_scores: {
    declaration: {
      name: 'sports_scores',
      description: "Live and today's scores and fixtures for a league, optionally one team. For other sports or older results use web_search.",
      parameters: obj({ league: { type: 'string', enum: Object.keys(LEAGUES) }, team: str('Team name, e.g. "Arsenal"') }, ['league']),
    },
    run: (args) => scores(args),
  },

  crypto_price: {
    declaration: {
      name: 'crypto_price',
      description: 'Current price and 24 hour change of a cryptocurrency. For stocks use web_search.',
      parameters: obj({ coin: str('e.g. bitcoin, ETH'), currency: str('ISO code, default USD') }, ['coin']),
    },
    run: (args) => cryptoPrice(args),
  },

  navigate: view(
    'navigate',
    'Walking directions on the glasses: a route map with turn-by-turn arrows. Give a place or address, or a category for the nearest one.',
    ({ destination, category }) => ({ type: 'navigate', query: destination, category: RADAR_CATEGORIES[category] ? category : undefined }),
    obj({ destination: str('Place name or address'), category: { type: 'string', enum: Object.keys(RADAR_CATEGORIES) } }),
  ),

  start_guide: view(
    'start_guide',
    'Step-by-step recipe or how-to on the glasses, one step per screen; steps with a duration offer a one-press timer. ' +
      'Omit topic to use the recipe pasted in the phone app.',
    ({ topic }) => ({ type: 'guide', topic: topic || undefined }),
    obj({ topic: str('What to make or do, with any detail the user gave, e.g. "pancakes for 4"') }),
  ),

  add_to_list: {
    declaration: {
      name: 'add_to_list',
      description: 'Add items to a checklist (shopping, packing, to-do...). Creates the list if needed.',
      parameters: obj({ list: str('List name, e.g. "shopping"'), items: { type: 'array', items: { type: 'string' } } }, ['list', 'items']),
    },
    async run({ list, items }, { lists }) {
      return lists.add(list, Array.isArray(items) ? items.map(String) : [String(items)])
    },
  },

  get_lists: {
    declaration: { name: 'get_lists', description: 'All checklists and their items with done state.', parameters: obj({}) },
    async run(_args, { lists }) {
      const all = lists.all
      return all.length ? all.map((l) => ({ list: l.name, items: l.items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.text}`) })) : { lists: [] }
    },
  },

  show_list: view(
    'show_list',
    'Open a checklist on the glasses to tick items off with the ring.',
    ({ list }) => ({ type: 'list', name: String(list ?? '') }),
    obj({ list: str('List name') }, ['list']),
  ),

  update_list_item: {
    declaration: {
      name: 'update_list_item',
      description: 'Tick off, untick or remove an item on a list.',
      parameters: obj({ list: str('List name'), item: str('Item text'), action: { type: 'string', enum: ['done', 'undone', 'remove'] } }, ['list', 'item', 'action']),
    },
    async run({ list, item, action }, { lists }) {
      const l = lists.find(list)
      if (!l) return { error: `No list called ${list}.` }
      const it = lists.item(l, item)
      if (!it) return { error: `No "${item}" on the ${l.name} list.` }
      if (action === 'remove') return { removed: await lists.removeItem(l.id, it.id), item: it.text }
      return { updated: await lists.setDone(l.id, it.id, action === 'done'), item: it.text, done: action === 'done' }
    },
  },

  clear_list: {
    declaration: {
      name: 'clear_list',
      description: 'Remove ticked items from a list, or delete the whole list.',
      parameters: obj({ list: str('List name'), everything: { type: 'boolean', description: 'true deletes all items' } }, ['list']),
    },
    async run({ list, everything }, { lists }) {
      const l = lists.find(list)
      if (!l) return { error: `No list called ${list}.` }
      return { removed: await lists.clear(l.id, !everything), list: l.name }
    },
  },

  start_activity: view(
    'start_activity',
    'Track a walk, run or bike ride with GPS: time, distance and pace on the glasses, saved to notes when finished.',
    ({ kind }) => ({ type: 'activity', kind: ACTIVITIES.includes(kind) ? kind : 'walk' }),
    obj({ kind: { type: 'string', enum: [...ACTIVITIES] } }, ['kind']),
  ),

  suit_diagnostics: view(
    'suit_diagnostics',
    'Show system diagnostics: glasses and phone battery, network, location, voice quota, hands-free state.',
    () => ({ type: 'diagnostics' }),
  ),

  set_hands_free: view(
    'set_hands_free',
    'Turn the hands-free wake word (saying "EDITH") on or off.',
    ({ on }) => ({ type: 'handsfree', on: !!on }),
    obj({ on: { type: 'boolean' } }, ['on']),
  ),

  set_personality: view(
    'set_personality',
    'Switch the assistant personality: edith (dry, tactical), friday (warm, Irish), jarvis (formal, British butler).',
    ({ name }) => ({ type: 'persona', id: PERSONA_IDS.includes(name) ? name : 'edith' }),
    obj({ name: { type: 'string', enum: PERSONA_IDS } }, ['name']),
  ),

  sync_calendar: {
    declaration: { name: 'sync_calendar', description: 'Refresh events from Google Calendar now.', parameters: obj({}) },
    async run(_args, { calendar }) {
      const n = await calendar.sync(true)
      return n < 0 ? { error: 'Google Calendar is not linked. Set it up in the phone app.' } : { events: n }
    },
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
      description: "Add an event to the user's calendar (their Google Calendar when linked, else the phone).",
      parameters: obj({ title: str('Event title'), start: TIME, end: TIME }, ['title', 'start']),
    },
    async run({ title, start, end }, { agenda, calendar }) {
      const [a, b] = [parseTime(start), end ? parseTime(end) : undefined]
      if (await calendar.linked()) {
        await calendar.create(title, a, b)
        return { saved: title, start: localIso(a), calendar: 'Google' }
      }
      const e = await agenda.addEvent(title, a, b)
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
        .map((e) => ({ id: e.id, title: e.title, start: localIso(e.start), end: e.end ? localIso(e.end) : undefined, allDay: e.allDay, google: e.source === 'google' }))
    },
  },

  delete_event: {
    declaration: {
      name: 'delete_event',
      description: 'Delete a calendar event by id (call list_events first to find it).',
      parameters: obj({ id: str('Event id') }, ['id']),
    },
    async run({ id }, { agenda }) {
      if (String(id).startsWith('g:')) return { error: 'That event is in Google Calendar; delete it there.' }
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

const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

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
