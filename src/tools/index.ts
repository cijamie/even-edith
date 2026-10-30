import type { Agenda } from '../data/agenda'
import type { Settings } from '../settings'
import { localIso, spokenDuration } from '../util/time'
import { currencyDeclaration, convertCurrency } from './currency'
import { getWeather, weatherDeclaration } from './weather'

/** What the tools can touch. `actions` lets a tool ask the HUD to do something (e.g. open the dashboard). */
export type ToolContext = { agenda: Agenda; settings: Settings; actions: Set<'dashboard'> }

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

const tools: Record<string, Tool> = {
  get_weather: {
    declaration: {
      ...weatherDeclaration,
      parameters: obj({ location: str('Place name. Omit to use the user\'s home city.') }),
    },
    async run({ location }, { settings }) {
      const place = location || (await settings.homeCity())
      if (!place) return { error: 'No location given and no home city set. Ask which city, or suggest setting a home city in the phone app.' }
      return getWeather({ location: place })
    },
  },

  convert_currency: { declaration: currencyDeclaration, run: (args) => convertCurrency(args) },

  open_dashboard: {
    declaration: {
      name: 'open_dashboard',
      description:
        'Show the dashboard (time, weather, timers, reminders, calendar, latest note) on the glasses. ' +
        'Use when the user asks to open, show or bring up the dashboard, or for an overview of their day.',
      parameters: obj({}),
    },
    async run(_args, { actions }) {
      actions.add('dashboard')
      return { opened: true, note: 'Reply with a very short acknowledgement only.' }
    },
  },

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
      description: "Add an event to the user's Jarvis calendar (stored on the phone).",
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
