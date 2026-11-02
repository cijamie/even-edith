import type { Agenda } from './data/agenda'
import type { Lists } from './data/lists'
import type { Expenses } from './data/expenses'
import { periodStart } from './data/expenses'
import { clock, isSameDay } from './util/time'

/**
 * "EDITH, debrief": the day in a few lines, from what's on the phone. Works
 * offline: meetings and activities from notes, spending, open list items,
 * and tomorrow's first event.
 */
export function debrief({ agenda, lists, expenses }: { agenda: Agenda; lists: Lists; expenses: Expenses }, now = Date.now()): string {
  const lines: string[] = []
  const today = agenda.events.filter((e) => isSameDay(e.start, now) && !e.allDay)
  const done = today.filter((e) => (e.end ?? e.start) <= now)
  lines.push(today.length ? `${done.length} of ${today.length} events done${done.length < today.length ? `, next ${today.find((e) => (e.end ?? e.start) > now)!.title}` : ''}.` : 'No events today.')

  const notes = agenda.notes.filter((n) => isSameDay(n.createdAt, now))
  const meetings = notes.filter((n) => n.text.startsWith('Meeting '))
  if (meetings.length) lines.push(`${meetings.length} meeting${meetings.length > 1 ? 's' : ''} recorded.`)
  // Activity notes look like "Walk 08:12: 3.40 km in 41:02, pace ...".
  const moves = notes.map((n) => n.text.match(/^(Walk|Run|Ride) \d\d:\d\d: ([\d.]+) (km|mi)/)).filter((m): m is RegExpMatchArray => !!m)
  if (moves.length) {
    const unit = moves[0][3]
    const total = moves.reduce((n, m) => n + Number(m[2]), 0)
    lines.push(`Moved ${total.toFixed(1)} ${unit} over ${moves.length} ${moves.length > 1 ? 'activities' : moves[0][1].toLowerCase()}.`)
  }
  const spent = expenses.since(periodStart('today', now))
  if (spent.length) lines.push(`Spent ${expenses.total(spent)} on ${spent.length} thing${spent.length > 1 ? 's' : ''}.`)
  const other = notes.length - meetings.length - moves.length
  if (other > 0) lines.push(`${other} note${other > 1 ? 's' : ''} taken.`)

  const open = lists.all.map((l) => ({ name: l.name, left: l.items.filter((i) => !i.done).length })).filter((l) => l.left)
  if (open.length) lines.push(`Still open: ${open.slice(0, 3).map((l) => `${l.left} on ${l.name}`).join(', ')}.`)

  const tomorrow = agenda.events.filter((e) => isSameDay(e.start, now + 86400_000)).sort((a, b) => a.start - b.start)
  lines.push(tomorrow.length ? `Tomorrow starts with ${tomorrow[0].title}${tomorrow[0].allDay ? '' : ` at ${clock(tomorrow[0].start)}`}.` : 'Tomorrow is clear.')
  lines.push(new Date(now).getHours() >= 21 ? 'Get some rest. That is not a suggestion.' : 'That concludes the debrief.')
  return lines.join('\n')
}
