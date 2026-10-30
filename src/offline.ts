import type { Agenda } from './data/agenda'
import type { Lists } from './data/lists'
import type { Dashboard } from './hud/dashboard'
import { clock, countdown, isSameDay } from './util/time'

/**
 * Answers from what's already on the phone, for when Gemini can't be reached:
 * time, date, timers, schedule, notes, lists and the last known weather.
 * Takes the normalised command (lowercase, no punctuation). Returns null if it can't help.
 */
export function offlineAnswer(command: string, { agenda, lists, dashboard }: { agenda: Agenda; lists: Lists; dashboard: Dashboard }): string | null {
  const now = Date.now()
  const c = command

  if (/\b(what time|the time)\b/.test(c)) return `It's ${clock(now)}.`
  if (/\b(what s the date|what is the date|what day|today s date)\b/.test(c)) {
    return `It's ${new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.`
  }
  if (/\btimers?\b/.test(c) && !/\bset|start\b/.test(c)) {
    const t = agenda.timers
    return t.length ? t.map((x) => `${x.label}: ${countdown((x.endsAt - now) / 1000)} left`).join('. ') + '.' : 'No timers running.'
  }
  // Lists before the calendar: "what's on my shopping list" isn't a schedule question.
  const listMatch = c.match(/\b(?:on |what s on |read )?(?:my |the )?(\w+) list\b/)
  if (listMatch && !/\badd\b/.test(c)) {
    const l = lists.find(listMatch[1])
    if (l) {
      const left = l.items.filter((i) => !i.done).map((i) => i.text)
      return left.length ? `${l.name}: ${left.join(', ')}.` : `${l.name} is all done.`
    }
  }
  if (/\b(schedule|calendar|agenda|what s on|what is on|meetings?|events?)\b/.test(c)) {
    const tomorrow = /\btomorrow\b/.test(c)
    const day = tomorrow ? now + 86400_000 : now
    const events = agenda.events.filter((e) => isSameDay(e.start, day) && (tomorrow || (e.end ?? e.start) >= now))
    const when = tomorrow ? 'tomorrow' : 'for the rest of today'
    return events.length ? `${events.map((e) => `${e.allDay ? 'All day' : clock(e.start)} ${e.title}`).join('. ')}.` : `Nothing ${when}.`
  }
  if (/\breminders?\b/.test(c) && !/\bremind me\b/.test(c)) {
    const r = agenda.reminders.slice(0, 4)
    return r.length ? r.map((x) => `${clock(x.at)} ${x.text}`).join('. ') + '.' : 'No reminders.'
  }
  if (/\bnotes?\b/.test(c) && !/\b(add|save|take|make)\b/.test(c)) {
    const n = agenda.notes[0]
    return n ? `Latest note: ${n.text}` : 'No notes.'
  }
  if (/\b(weather|temperature|rain|cold|hot)\b/.test(c)) {
    const w = dashboard.cachedWeather
    return w ? `Last reading at ${clock(w.at)}: ${w.line.toLowerCase()}.` : null
  }
  return null
}
