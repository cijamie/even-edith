import { REPEATS, type Agenda, type Repeat } from '../data/agenda'
import type { Flashcards } from '../data/flashcards'
import { CATEGORIES, until, type Category, type Memory } from '../data/memory'
import type { Locator } from '../geo/location'
import { findPlace, PROFILES, type Profile } from '../geo/route'
import type { Notice } from '../net/relay'
import type { Settings } from '../settings'
import { localIso, spokenDuration } from '../util/time'
import { calculateTool } from './calc'
import { currencyDeclaration, convertCurrency } from './currency'
import { getNews } from './news'
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
  | { type: 'navigate'; query?: string; radar?: number; profile?: Profile }
  | { type: 'news'; topic: 'world' | 'tech' }
  | { type: 'flashcards'; deck?: string }

/** What the tools can touch. */
export type ToolContext = {
  agenda: Agenda
  memory: Memory
  flashcards: Flashcards
  settings: Settings
  locator: Locator
  /** Notifications relayed from the phone, newest first. */
  notices: () => Notice[]
  /** Glasses battery etc., filled in from the SDK. */
  deviceStatus: () => Record<string, unknown>
  actions: Action[]
}

type Tool = { declaration: object; run: (args: any, ctx: ToolContext) => Promise<unknown> }

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: 'object', properties, required })
const str = (description: string) => ({ type: 'string', description })
const TIME = str('Local date-time, ISO 8601 without timezone, e.g. 2026-10-30T15:00:00')
const LIST = str('List name, e.g. "shopping", "todo", "packing". Default "shopping".')
const ITEMS = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

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
      description:
        'Store a fact about the user or something they want remembered. Pick a category. For short-lived things ' +
        '(where they parked, where they left something, today-only plans) set expires, e.g. parking: end of the day. ' +
        'Lasting facts (allergies, names, preferences) have no expiry.',
      parameters: obj(
        {
          fact: str('The fact, phrased in third person or as a short statement'),
          category: { type: 'string', enum: [...CATEGORIES] },
          expires: str('Optional local ISO time when the fact stops being true, e.g. 2026-10-30T23:59:00'),
        },
        ['fact', 'category'],
      ),
    },
    async run({ fact, category, expires }, { memory }) {
      const exp = expires ? parseTime(expires) : undefined
      if (exp != null && exp <= Date.now()) return { error: 'That expiry has already passed.' }
      const cat: Category = CATEGORIES.includes(category) ? category : 'other'
      const f = await memory.add(fact, cat, exp)
      return { remembered: f.text, category: cat, id: f.id, ...(exp && { until: until(exp) }) }
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

  calculate: {
    declaration: {
      name: 'calculate',
      description: 'Exact arithmetic. Use for any sum you would otherwise do in your head: + - * / ^, sqrt, %, brackets.',
      parameters: obj({ expression: str('e.g. "(84*0.15)+12" or "sqrt(2)"') }, ['expression']),
    },
    run: (args) => Promise.resolve(calculateTool(args)),
  },

  get_news: {
    declaration: {
      name: 'get_news',
      description:
        'Current headlines. topic "world" is Wikipedia\'s In the news (major world events); "tech" is the Hacker News front page. ' +
        'query searches the past week of Hacker News stories (tech-leaning). Summarise briefly.',
      parameters: obj({ topic: { type: 'string', enum: ['world', 'tech'] }, query: str('Optional search words') }),
    },
    run: (args) => getNews(args),
  },

  show_news: view(
    'show_news',
    'Show a list of headlines on the HUD. Use when the user just says "news" or "headlines" without a specific question.',
    ({ topic }) => ({ type: 'news', topic: topic === 'tech' ? 'tech' : 'world' }),
    obj({ topic: { type: 'string', enum: ['world', 'tech'] } }),
  ),

  navigate: view(
    'navigate',
    'Turn-by-turn directions on the HUD map from where the user is now. destination is a place name or address ' +
      '("British Museum", "nearest Boots", "home"); or radar_number picks a numbered blip from the last radar. ' +
      'profile: foot (default), bike or car.',
    ({ destination, radar_number, profile }) => ({
      type: 'navigate',
      query: destination,
      radar: radar_number ? Number(radar_number) : undefined,
      profile: PROFILES.includes(profile) ? profile : 'foot',
    }),
    obj({ destination: str('Place, address or "home"'), radar_number: { type: 'integer' }, profile: { type: 'string', enum: [...PROFILES] } }),
  ),

  get_notifications: {
    declaration: {
      name: 'get_notifications',
      description: 'Notifications relayed from the phone to EDITH (newest first). Use for "any messages?" or "read my notifications".',
      parameters: obj({}),
    },
    async run(_args, { notices }) {
      const list = notices()
      if (!list.length) return { notifications: [], note: 'None received. The relay is set up in the phone app.' }
      return { notifications: list.slice(0, 10).map((n) => ({ title: n.title, message: n.message, at: localIso(n.at) })) }
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
      description:
        'Remind the user about something at a time. The glasses show it when due. For "every day at 8", "weekdays", ' +
        '"every Monday" etc. set repeat and give the first time it should fire.',
      parameters: obj({ text: str('What to remind about'), time: TIME, repeat: { type: 'string', enum: [...REPEATS] } }, ['text', 'time']),
    },
    async run({ text, time, repeat }, { agenda }) {
      const at = parseTime(time)
      const r: Repeat = REPEATS.includes(repeat) ? repeat : 'none'
      if (at < Date.now() - 60000 && r === 'none') return { error: 'That time has already passed.' }
      const saved = await agenda.addReminder(text, at, r)
      return { saved: saved.text, at: localIso(saved.at), repeat: r }
    },
  },

  add_place_reminder: {
    declaration: {
      name: 'add_place_reminder',
      description:
        'Remind the user when they are near a kind of place ("next time I pass a pharmacy") or a specific place ' +
        '("when I get to the office", "at Tesco on High Street"). Fires once, while EDITH is open. ' +
        `place_type is one of: ${Object.keys(RADAR_CATEGORIES).join(', ')}. Otherwise give place.`,
      parameters: obj(
        { text: str('What to remind about'), place_type: { type: 'string', enum: Object.keys(RADAR_CATEGORIES) }, place: str('Named place or address') },
        ['text'],
      ),
    },
    async run({ text, place_type, place }, { agenda, locator }) {
      if (place_type && RADAR_CATEGORIES[place_type]) {
        const r = await agenda.addPlaceReminder({ text, label: `any ${place_type.replace('_', ' ')}`, category: place_type })
        return { saved: r.text, near: r.label }
      }
      if (!place) return { error: 'Need a place_type or a place.' }
      const found = await findPlace(place, await locator.get(10 * 60_000))
      if (!found) return { error: `Could not find ${place}.` }
      const r = await agenda.addPlaceReminder({ text, label: found.name, lat: found.lat, lon: found.lon })
      return { saved: r.text, near: r.label }
    },
  },

  list_reminders: {
    declaration: { name: 'list_reminders', description: 'List upcoming reminders, repeating ones and place reminders.', parameters: obj({}) },
    async run(_args, { agenda }) {
      return {
        timed: agenda.reminders.map((r) => ({ id: r.id, text: r.text, at: localIso(r.at), repeat: r.repeat ?? 'none' })),
        places: agenda.places.map((p) => ({ id: p.id, text: p.text, near: p.label })),
      }
    },
  },

  delete_reminder: {
    declaration: {
      name: 'delete_reminder',
      description: 'Delete a timed or place reminder by id (call list_reminders first to find it). Stops a repeating one for good.',
      parameters: obj({ id: str('Reminder id') }, ['id']),
    },
    async run({ id }, { agenda }) {
      return { deleted: (await agenda.remove('reminders', [id])) + (await agenda.remove('places', [id])) }
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
      description: 'Save a free-form note (ideas, thoughts). Use lists instead for shopping or to-do items.',
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

  add_to_list: {
    declaration: {
      name: 'add_to_list',
      description: 'Add items to a named list (shopping, todo, packing...). Creates the list if needed.',
      parameters: obj({ list: LIST, items: ITEMS('One entry per item, e.g. ["milk", "eggs"]') }, ['items']),
    },
    run: ({ list, items }, { agenda }) => agenda.addToList(list ?? 'shopping', [].concat(items ?? [])),
  },

  show_list: {
    declaration: {
      name: 'show_list',
      description: 'Read a list. With no name, gives every list and its open item count.',
      parameters: obj({ list: LIST }),
    },
    async run({ list }, { agenda }) {
      if (!list) return agenda.lists.map((l) => ({ list: l.name, open: l.items.filter((i) => !i.done).length }))
      const l = agenda.list(list)
      if (!l) return { error: `No ${list} list.`, lists: agenda.lists.map((x) => x.name) }
      return { list: l.name, open: l.items.filter((i) => !i.done).map((i) => i.text), ticked: l.items.filter((i) => i.done).map((i) => i.text) }
    },
  },

  tick_items: {
    declaration: {
      name: 'tick_items',
      description: 'Tick off (or untick with done=false) items on a list. Loose matches are fine: "milk" ticks "oat milk".',
      parameters: obj({ list: LIST, items: ITEMS('Items to tick'), done: { type: 'boolean' } }, ['items']),
    },
    async run({ list, items, done }, { agenda }) {
      const hit = await agenda.markItems(list ?? 'shopping', [].concat(items ?? []), done !== false)
      return hit.length ? { ticked: hit, done: done !== false } : { error: 'None of those are on the list.' }
    },
  },

  remove_from_list: {
    declaration: {
      name: 'remove_from_list',
      description: 'Remove items from a list entirely.',
      parameters: obj({ list: LIST, items: ITEMS('Items to remove') }, ['items']),
    },
    async run({ list, items }, { agenda }) {
      return { removed: await agenda.removeItems(list ?? 'shopping', [].concat(items ?? [])) }
    },
  },

  clear_list: {
    declaration: {
      name: 'clear_list',
      description: 'Clear a list: only_ticked=true removes just the ticked items; delete_list=true removes the list itself.',
      parameters: obj({ list: LIST, only_ticked: { type: 'boolean' }, delete_list: { type: 'boolean' } }, ['list']),
    },
    async run({ list, only_ticked, delete_list }, { agenda }) {
      return { removed: await agenda.clearList(list, !!only_ticked, !!delete_list) }
    },
  },

  add_flashcards: {
    declaration: {
      name: 'add_flashcards',
      description:
        'Create flashcards in a deck. When the user wants to learn or practise something (a language, capitals, a topic), ' +
        'write the cards yourself: 10 to 20 short ones unless they say otherwise. Front is the prompt, back the answer. ' +
        'Keep each side under 80 characters.',
      parameters: obj(
        {
          deck: str('Deck name, e.g. "spanish food"'),
          cards: {
            type: 'array',
            items: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' } }, required: ['front', 'back'] },
          },
        },
        ['deck', 'cards'],
      ),
    },
    run: ({ deck, cards }, { flashcards }) => flashcards.add(deck, [].concat(cards ?? [])),
  },

  list_decks: {
    declaration: { name: 'list_decks', description: 'Flashcard decks with total and due counts.', parameters: obj({}) },
    async run(_args, { flashcards }) {
      return flashcards.decks()
    },
  },

  delete_deck: {
    declaration: {
      name: 'delete_deck',
      description: 'Delete a flashcard deck and all its cards.',
      parameters: obj({ deck: str('Deck name') }, ['deck']),
    },
    async run({ deck }, { flashcards }) {
      return { deleted: await flashcards.removeDeck(deck) }
    },
  },

  study_flashcards: view(
    'study_flashcards',
    'Start a flashcard session on the HUD (due cards first). Omit deck to study all decks. Use for "quiz me" or "practise my Spanish".',
    ({ deck }) => ({ type: 'flashcards', deck: deck || undefined }),
    obj({ deck: str('Deck name') }),
  ),
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
