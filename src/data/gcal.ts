import { requestJson } from '../net/http'
import type { Settings } from '../settings'
import type { Agenda, CalEvent } from './agenda'

const SYNC_MS = 15 * 60_000

/**
 * Pasted into script.google.com and deployed as a web app in the user's own
 * account. Google's calendar feeds block browser requests; an Apps Script web
 * app doesn't, and needs no OAuth client.
 */
export const APPS_SCRIPT = `// Even EDITH calendar bridge. Deploy > New deployment > Web app,
// Execute as: Me, Who has access: Anyone. Keep the URL private.
function doGet(e) {
  // Aircraft near a point, for "what plane is that?" (ADS-B feeds block browser requests).
  if (e && e.parameter.planes) {
    var p = e.parameter.planes.split(',').map(Number)
    var r = UrlFetchApp.fetch('https://api.adsb.lol/v2/point/' + p[0] + '/' + p[1] + '/15', { muteHttpExceptions: true })
    return ContentService.createTextOutput(r.getContentText()).setMimeType(ContentService.MimeType.JSON)
  }
  var days = Number((e && e.parameter.days) || 14)
  var from = new Date(Date.now() - 86400000)
  var to = new Date(Date.now() + days * 86400000)
  var events = CalendarApp.getDefaultCalendar().getEvents(from, to).map(function (ev) {
    return {
      id: ev.getId() + '@' + ev.getStartTime().getTime(),
      title: ev.getTitle(),
      start: ev.getStartTime().getTime(),
      end: ev.getEndTime().getTime(),
      allDay: ev.isAllDayEvent(),
      location: ev.getLocation(),
      guests: ev.getGuestList().slice(0, 8).map(function (g) { return g.getName() || g.getEmail() })
    }
  })
  return json({ events: events })
}
function doPost(e) {
  var b = JSON.parse(e.postData.contents)
  var ev = CalendarApp.getDefaultCalendar().createEvent(b.title, new Date(b.start), new Date(b.end || b.start + 3600000))
  return json({ id: ev.getId() + '@' + ev.getStartTime().getTime() })
}
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)
}`

export const looksLikeScriptUrl = (url: string) => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim())

/** Pulls Google Calendar events into the agenda through the user's Apps Script bridge. */
export class GoogleCalendar {
  private lastSync = 0
  private syncing: Promise<number> | null = null
  lastError = ''

  constructor(
    private settings: Settings,
    private agenda: Agenda,
  ) {}

  async linked() {
    return !!(await this.settings.calendarUrl())
  }

  /** Syncs if it's been a while (or `force`); resolves to the number of events, or -1 when not linked. */
  sync(force = false): Promise<number> {
    if (this.syncing) return this.syncing
    if (!force && Date.now() - this.lastSync < SYNC_MS) return Promise.resolve(0)
    this.syncing = (async () => {
      // Set first, so the once-a-second caller doesn't hit storage while unlinked either.
      this.lastSync = Date.now()
      const url = await this.settings.calendarUrl()
      if (!url) {
        // Unlinked: drop anything synced earlier.
        if (this.agenda.events.some((e) => e.source === 'google')) await this.agenda.replaceExternal([])
        return -1
      }
      try {
        const body = await requestJson<{ events?: any[] }>(`${url}?days=14`, {}, 20000)
        const events: CalEvent[] = (body.events ?? [])
          .filter((e) => e && e.title != null && Number.isFinite(Number(e.start)))
          .map((e) => ({
            id: `g:${e.id}`,
            title: String(e.title || '(no title)'),
            start: Number(e.start),
            end: e.end ? Number(e.end) : undefined,
            allDay: !!e.allDay,
            location: e.location ? String(e.location) : undefined,
            guests: Array.isArray(e.guests) && e.guests.length ? e.guests.map(String) : undefined,
          }))
        await this.agenda.replaceExternal(events)
        this.lastError = ''
        return events.length
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        throw err
      }
    })().finally(() => (this.syncing = null))
    return this.syncing
  }

  /**
   * Aircraft within ~28 km, fetched by the Apps Script (adsb.lol ADS-B data),
   * since the public ADS-B feeds don't allow requests from a web page.
   */
  async planes(lat: number, lon: number): Promise<any[]> {
    const url = await this.settings.calendarUrl()
    if (!url) throw new Error('not linked')
    const body = await requestJson<{ ac?: any[] }>(`${url}?planes=${lat.toFixed(4)},${lon.toFixed(4)}`, {}, 20000)
    if (!Array.isArray(body.ac)) throw new Error('old script')
    return body.ac
  }

  /** Creates an event in Google Calendar, then re-syncs. */
  async create(title: string, start: number, end?: number) {
    const url = await this.settings.calendarUrl()
    if (!url) throw new Error('Google Calendar is not linked.')
    // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script can't answer.
    await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ title, start, end }) }, 20000)
    await this.sync(true).catch(() => {})
  }
}
