import type { Agenda } from './data/agenda'
import type { Memory } from './data/memory'
import { calculate, convertUnits } from './tools/calc'
import { searchCurrentEvents } from './tools/news'
import { clock, countdown, spokenDuration } from './util/time'

/**
 * Requests EDITH answers on the phone, without Gemini.
 *
 * `instant` covers things that are faster and more exact done locally (sums,
 * conversions, the time) and runs before Gemini. `offline` covers the everyday
 * commands when Gemini can't be reached: no connection, no key, or rate limited.
 * Both match whole sentences only, so anything subtler still goes to Gemini.
 */
export function instant(raw: string): string | null {
  const s = tidy(raw)
  if (/^(?:what(?: s| is)? (?:the )?time(?: is it)?(?: now)?|what time is it|time)$/.test(s)) return `It's ${clock(Date.now())}.`
  if (/^(?:what(?: s| is)? (?:the |today s )?(?:date|day)(?: today| is it)?(?: today)?|what day is it(?: today)?|today s date)$/.test(s)) {
    return `It's ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`
  }
  const sum = calculate(raw)
  if (sum != null) return `That's ${sum}.`
  return convertUnits(raw)
}

export async function offline(raw: string, agenda: Agenda, memory: Memory): Promise<string | null> {
  const s = tidy(raw)
  // Commas kept, for splitting list items.
  const listy = tidy(raw, true)
  let m: RegExpExecArray | null

  // Timers: "set a timer for 10 minutes for pasta", "start a pasta timer for 8 minutes", "10 minute pasta timer".
  const timer = parseTimer(s)
  if (timer) {
    await agenda.addTimer(timer.seconds, timer.label)
    return `${timer.label === 'timer' ? 'Timer' : `${cap(timer.label)} timer`} set for ${spokenDuration(timer.seconds)}.`
  }
  if (/^(?:how (?:long|much time) (?:is )?left|(?:list|show|check) (?:my )?timers?|timers?)$/.test(s)) {
    const t = agenda.timers
    return t.length ? t.map((x) => `${cap(x.label)}: ${countdown((x.endsAt - Date.now()) / 1000)} left.`).join('\n') : 'No timers running.'
  }
  if (/^(?:cancel|stop|delete|clear) (?:all )?(?:the |my )?timers?$/.test(s)) {
    const n = await agenda.remove('timers', agenda.timers.map((t) => t.id))
    return n ? `Cancelled ${n} timer${n > 1 ? 's' : ''}.` : 'No timers running.'
  }

  // Reminders: "remind me in 20 minutes to call mum", "remind me to call mum in 2 hours".
  if ((m = /^remind me in (.+?) (?:to|about) (.+)$/.exec(s)) || (m = /^remind me (?:to|about) (.+) in (.+)$/.exec(s))) {
    const [spec, text] = s.startsWith('remind me in') ? [m[1], m[2]] : [m[2], m[1]]
    const seconds = parseDuration(spec)
    if (seconds) {
      const r = await agenda.addReminder(text, Date.now() + seconds * 1000)
      return `I'll remind you at ${clock(r.at)}.`
    }
  }

  // Lists: "add milk and eggs to my shopping list", "what's on my shopping list", "tick off milk".
  if ((m = /^(?:add|put) (.+) (?:to|on) (?:my |the )?(.+?) list$/.exec(listy))) {
    const { list, added } = await agenda.addToList(m[2], splitItems(m[1]))
    return `Added ${added.join(', ')} to your ${list} list.`
  }
  if ((m = /^(?:what s|what is|read|show|open)(?: on)? (?:my |the )?(.+?) list$/.exec(s))) {
    const list = agenda.list(m[1])
    const open = list?.items.filter((i) => !i.done) ?? []
    return open.length ? `${cap(list!.name)}: ${open.map((i) => i.text).join(', ')}.` : `Your ${m[1]} list is empty.`
  }
  if ((m = /^(?:tick off|check off|cross off|got|bought) (.+?)(?: (?:from|on) (?:my |the )?(.+?) list)?$/.exec(listy))) {
    const done = await agenda.markItems(m[2] ?? 'shopping', splitItems(m[1]))
    if (done.length) return `Ticked off ${done.join(', ')}.`
  }

  // News, from the free Wikipedia feed: "news about Ukraine", "what's happening in Haiti".
  if ((m = /^(?:(?:what s|what is|any) )?(?:the )?(?:latest )?(?:news (?:about|on|from)|happening (?:in|with)|latest on) (.+)$/.exec(s))) {
    const found = await searchCurrentEvents(m[1], 3).catch(() => null)
    if (!found) return "I can't reach the news feeds either."
    return found.length ? found.map((f) => `${f.date.replace(/^\d{4} /, '')}: ${f.text}`).join('\n') : `Nothing on ${m[1]} in the past week's Wikipedia news.`
  }

  // Notes and memory.
  if ((m = /^(?:take a note|make a note|note|write down|jot down)(?: that)? (.+)$/.exec(s))) {
    await agenda.addNote(m[1])
    return 'Noted.'
  }
  if ((m = /^remember(?: that)? (.+)$/.exec(s))) {
    // Without Gemini to judge, guess: parking spots and today's plans expire tonight.
    const shortLived = /\b(?:parked|left (?:my|the)|today|tonight|this (?:morning|afternoon|evening))\b/.test(m[1])
    const tonight = new Date()
    tonight.setHours(23, 59, 0, 0)
    await memory.add(m[1], shortLived ? 'temporary' : 'other', shortLived ? tonight.getTime() : undefined)
    return shortLived ? "I'll remember that until tonight." : "I'll remember that."
  }

  return null
}

export const OFFLINE_HELP =
  'Local systems still handle timers, "remind me in", notes, lists, "remember", "news about…", sums, conversions and the time.'

/** Lowercase, punctuation to spaces (commas optionally kept), no "EDITH," prefix or "please". */
const tidy = (raw: string, keepCommas = false) =>
  raw
    .toLowerCase()
    .replace(keepCommas ? /[^\p{L}\p{N}\s,]/gu : /[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |okay )?(?:edith|edit|jarvis)[,\s]*/, '')
    .replace(/^(?:please |can you |could you )+/, '')
    .replace(/,? please$/, '')
    .replace(/,$/, '')

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, fifty: 50, sixty: 60, ninety: 90,
}
const UNIT_SECONDS: Record<string, number> = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600 }

/** "10 minutes", "an hour and a half", "1 hour 20 minutes", "half an hour", "90 secs" → seconds. */
export function parseDuration(spec: string): number | null {
  let s = ` ${spec.toLowerCase().trim()} `
  if (/^ half an? hour $/.test(s)) return 1800
  let total = 0
  let found = false
  // "two and a half minutes" and "an hour and a half".
  const half = (u: string, out: string) => {
    total += UNIT_SECONDS[u] / 2
    return out
  }
  s = s.replace(/ and a half (hour|minute)s? /g, (_, u) => half(u, ` ${u}s `)).replace(/ (hour|minute)s? and a half /g, (_, u) => half(u, ` ${u} `))
  const re = /(\d+(?:\.\d+)?|forty five|[a-z]+) (second|sec|minute|min|hour|hr)s?\b/g
  for (const [, n, unit] of s.matchAll(re)) {
    const v = /^\d/.test(n) ? Number(n) : WORDS[n]
    if (v == null) return null
    total += v * UNIT_SECONDS[unit]
    found = true
  }
  // Anything left besides joiners means it wasn't purely a duration.
  const rest = s.replace(re, '').replace(/\b(?:and|for)\b/g, '').trim()
  return found && !rest && total > 0 && total <= 86400 ? Math.round(total) : null
}

function parseTimer(s: string): { seconds: number; label: string } | null {
  const lead = /^(?:set |start )?(?:an? |the )?/
  let m = /^(?:(\w+) )?timer (?:for )?(.+?)(?: (?:for|called) (\w+(?: \w+)?))?$/.exec(s.replace(lead, ''))
  if (m) {
    const seconds = parseDuration(m[2])
    if (seconds) return { seconds, label: (m[3] ?? m[1] ?? 'timer').toLowerCase() }
  }
  m = /^(.+) timer$/.exec(s.replace(lead, ''))
  if (m) {
    // "10 minute timer" or "10 minute pasta timer".
    const words = m[1].split(' ')
    const whole = parseDuration(m[1])
    if (whole) return { seconds: whole, label: 'timer' }
    const seconds = parseDuration(words.slice(0, -1).join(' '))
    if (seconds) return { seconds, label: words[words.length - 1] }
  }
  return null
}

const splitItems = (s: string) => s.split(/,| and | & /).map((x) => x.trim()).filter(Boolean)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
