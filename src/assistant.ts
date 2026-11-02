import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent, type DeviceStatus } from '@evenrealities/even_hub_sdk'
import type { Display } from './hud/display'
import { GLYPHS, ID } from './hud/layout'
import { sleep, typewrite, type Typing } from './hud/typewriter'
import { paginate } from './hud/paginate'
import { Waveform } from './hud/waveform'
import { Dashboard } from './hud/dashboard'
import { Recorder } from './voice/recorder'
import { matchWake, WakeListener, type Utterance } from './voice/wake'
import { isNoise, transcribe, GROQ_FREE, type GroqUsage } from './net/groq'
import { Brain } from './net/gemini'
import { ApiError } from './net/http'
import type { Agenda } from './data/agenda'
import type { Memory } from './data/memory'
import type { Lists } from './data/lists'
import type { Transcript } from './data/transcript'
import type { GoogleCalendar } from './data/gcal'
import type { Pins } from './data/pins'
import type { Decks } from './data/decks'
import { money, parseExpense, periodStart, type Expenses } from './data/expenses'
import { Proactive } from './proactive'
import { debrief } from './debrief'
import { VERSION, whatsNew } from './version'
import type { Locator } from './geo/location'
import type { Settings } from './settings'
import { persona, type PersonaId } from './persona'
import { RADAR_CATEGORIES, type Action, type Protocol } from './tools'
import { quickAnswer } from './tools/calc'
import { offlineAnswer } from './offline'
import type { Host, Mode } from './modes/mode'
import { CaptionsMode } from './modes/captions'
import { MeetingMode } from './modes/meeting'
import { FollowTeleprompterMode, TeleprompterMode } from './modes/teleprompter'
import { EmergencyMode } from './modes/emergency'
import { FlashcardMode } from './modes/flashcards'
import { MapMode, RadarMode } from './modes/map'
import { NavMode } from './modes/nav'
import { GuideMode } from './modes/guide'
import { ListMode } from './modes/list'
import { ActivityMode } from './modes/activity'
import { bar, SuitMode } from './modes/suit'
import { IronManMode } from './modes/ironman'
import { countdown } from './util/time'

type State = 'idle' | 'listening' | 'thinking'
type View = 'answer' | 'dashboard'

const HUD_CHROME = { [ID.tl]: GLYPHS.tl, [ID.tr]: GLYPHS.tr, [ID.bl]: GLYPHS.bl, [ID.br]: GLYPHS.br }
const NUDGE_LEAD_MS = 10 * 60_000
// Wake checks share Groq's free requests-per-minute with everything else; leave room.
const WAKE_GAP_MS = Math.ceil(60_000 / (GROQ_FREE.requestsPerMinute - 6))
// The name alone, not "Hey Jarvis": the glasses' own "Hey Even" wake word fires on "Hey E...".
const WAKE_PROMPT = 'Jarvis.'

// Handled locally so these open instantly, without a round trip to Gemini.
const FAST: [RegExp, Action | 'close'][] = [
  [/^(?:(?:please|can you|could you)\s+)?(?:open|show|bring up|display|pull up)(?: me)?(?: the| my)? dashboard\b/, { type: 'dashboard' }],
  [/^(?:(?:please|can you|could you)\s+)?(?:open|show)(?: me)?(?: the| a| my)? map\b|^where am i\b/, { type: 'map' }],
  [/^(?:start |open |turn on )?(?:live )?(?:captions|subtitles)\b/, { type: 'captions', translate: false }],
  [/^(?:start |open )?(?:translat(?:e|ion|or))(?: mode)?$/, { type: 'captions', translate: true }],
  [/^(?:open |start )?(?:the )?(?:voice |follow(?:ing)? )teleprompter\b|^teleprompter follow/, { type: 'teleprompter', follow: true }],
  [/^(?:open |start )?(?:the )?teleprompter\b/, { type: 'teleprompter' }],
  [/^(?:emergency|emergency protocol|i need help|call for help)$/, { type: 'emergency' }],
  [/^(?:give me |run )?(?:the |a |my )?(?:daily |end of day )?debrief$/, { type: 'debrief' }],
  [/^(?:what s new|whats new|what is new|changelog)\b/, { type: 'whatsnew' }],
  [/^(?:start |open |practi[sc]e )?(?:my )?flash ?cards$/, { type: 'flashcards' }],
  [/^(?:start |record )(?:a |the )?meeting\b|^meeting mode\b/, { type: 'meeting' }],
  [/^(?:run |open |show )?(?:suit |system )?diagnostics\b|^status report\b/, { type: 'diagnostics' }],
  [/^(?:start|turn on|enable) hands ?free\b/, { type: 'handsfree', on: true }],
  [/^(?:stop|turn off|disable) hands ?free\b|^stop listening\b/, { type: 'handsfree', on: false }],
  [/\bhouse party protocol\b/, { type: 'easter', id: 'house-party' }],
  [/\bclean slate protocol\b/, { type: 'easter', id: 'clean-slate' }],
  [/^i(?: am| m)? iron ?man\b/, { type: 'easter', id: 'iron-man' }],
  [/\bself destruct\b/, { type: 'easter', id: 'self-destruct' }],
  [/^(?:are you there|you there|you up|wake up)\b/, { type: 'easter', id: 'there' }],
  [/^(?:close|hide|dismiss|exit)\b|^stop$/, 'close'],
]

export type Deps = {
  agenda: Agenda
  memory: Memory
  locator: Locator
  usage: GroqUsage
  lists: Lists
  transcript: Transcript
  calendar: GoogleCalendar
  pins: Pins
  expenses: Expenses
  decks: Decks
}

/**
 * Ring-to-talk loop: hold to record, release to transcribe (Groq Whisper),
 * ask (Gemini), then type the answer out with swipe paging. A single press also
 * starts/stops listening, as a fallback for long press. With hands-free on,
 * saying "Jarvis" (or "OK Jarvis") does the same without touching the ring.
 * Also owns the dashboard, full-screen modes, protocols, alerts and briefings.
 */
export class Assistant {
  private state: State = 'idle'
  private view: View = 'answer'
  private mode: Mode | null = null
  private pages: string[] = []
  private page = 0
  private typing: Typing | null = null
  private waveform = new Waveform()
  private recorder: Recorder
  private wake: WakeListener
  readonly brain: Brain
  private dashboard: Dashboard
  private spinner: ReturnType<typeof setInterval> | undefined
  private alerts: string[] = []
  private alerting = false
  private lastDashboard = ''
  private protocol: Protocol = 'standard'
  private focusEndsAt = 0
  private device: DeviceStatus | null = null
  private briefingCheck = false
  private host: Host
  private live = false
  private persona: PersonaId = 'jarvis'
  private handsFree = false
  private wakeBusy = false
  private lastWakeRequest = 0
  private agenda: Agenda
  private lists: Lists
  private usage: GroqUsage
  private calendar: GoogleCalendar
  private locator: Locator
  private expenses: Expenses
  private proactive: Proactive
  /** Anything asked or run since launch (keeps the what's-new note from covering it). */
  private asked = false

  constructor(
    private bridge: EvenAppBridge,
    private display: Display,
    private settings: Settings,
    deps: Deps,
  ) {
    ;({ agenda: this.agenda, lists: this.lists, usage: this.usage, calendar: this.calendar, locator: this.locator, expenses: this.expenses } = deps)
    this.proactive = new Proactive({ settings, agenda: deps.agenda, locator: deps.locator, memory: deps.memory, pins: deps.pins })
    this.recorder = new Recorder(bridge, (level) => void this.display.set(ID.footer, this.waveform.push(level)))
    this.wake = new WakeListener(bridge, (u) => void this.onUtterance(u))
    this.brain = new Brain(() => settings.get('gemini'), {
      agenda: deps.agenda,
      settings,
      memory: deps.memory,
      locator: deps.locator,
      lists: deps.lists,
      transcript: deps.transcript,
      calendar: deps.calendar,
      pins: deps.pins,
      expenses: deps.expenses,
      decks: deps.decks,
      deviceStatus: () => this.deviceSummary(),
    })
    this.dashboard = new Dashboard(deps.agenda, settings, () => this.statusLine())
    this.host = {
      bridge,
      display,
      settings,
      agenda: deps.agenda,
      brain: this.brain,
      locator: deps.locator,
      usage: deps.usage,
      lists: deps.lists,
      transcript: deps.transcript,
      pins: deps.pins,
      decks: deps.decks,
      diagnostics: () => this.diagnostics(),
      finish: (text, header) => this.closeMode(text, header),
      run: (action) => this.run(action),
    }
    void bridge
      .getDeviceInfo()
      .then((info) => (this.device = info?.status ?? null))
      .catch(() => {})
    bridge.onDeviceStatusChanged((s) => (this.device = s))
    setInterval(() => void this.tick(), 1000)
  }

  /** Loads preferences; call once the boot sequence is done. */
  async start() {
    await this.loadPrefs()
    this.live = true
    this.syncWake()
    void this.calendar.sync().catch(() => {})
    void this.maybeWhatsNew()
  }

  /** Once per version, a few seconds after boot so the greeting is seen first. */
  private async maybeWhatsNew() {
    if ((await this.settings.getState('seenVersion')) === VERSION || !whatsNew()) return
    setTimeout(() => {
      // Never over something the user asked for; it waits for the next launch instead.
      if (this.asked || this.mode || this.state !== 'idle' || this.typing || this.view !== 'answer') return
      void this.settings.setState('seenVersion', VERSION)
      void this.showWhatsNew()
    }, 5000)
  }

  private async showWhatsNew() {
    this.view = 'answer'
    void this.display.set(ID.header, `WHAT'S NEW · V${VERSION}`)
    await this.say(whatsNew() || 'Nothing new to report.')
  }

  /** Re-reads personality and hands-free after the phone settings change. */
  async loadPrefs() {
    const previous = this.persona
    this.persona = ((await this.settings.persona()) || 'jarvis') as PersonaId
    this.handsFree = await this.settings.handsFree()
    if (previous !== this.persona) this.brain.reset()
    if (!this.live) return
    this.syncWake()
    if (!this.mode && this.state === 'idle' && this.view === 'answer') {
      void this.display.set(ID.header, this.banner)
      void this.display.set(ID.footer, this.idleHint)
    }
  }

  get name() {
    return persona(this.persona).name
  }

  get banner() {
    if (this.protocol === 'focus') return `FOCUS · ${countdown((this.focusEndsAt - Date.now()) / 1000)}`
    if (this.protocol === 'night') return `${this.name} // NIGHT`
    return `${this.name} // ONLINE`
  }

  get idleHint() {
    return this.handsFree ? `SAY "${this.persona.toUpperCase()}" · HOLD` : 'HOLD · TALK'
  }

  get activeMode() {
    return this.mode?.name ?? (this.view === 'dashboard' ? 'dashboard' : null)
  }

  handle(event: EvenHubEvent) {
    if (event.audioEvent) {
      const a = event.audioEvent
      if (this.mode?.audio) this.mode.audio(a.audioPcm, a.speakerRole)
      else if (this.recorder.recording) this.recorder.push(a.audioPcm)
      else if (this.wake.active) this.wake.push(a)
      return
    }
    // Gestures can arrive on textEvent or sysEvent (the simulator uses sysEvent),
    // and CLICK_EVENT (0) is often dropped, leaving eventType undefined.
    const src = event.textEvent ?? event.sysEvent
    if (!src) return
    const type = src.eventType ?? OsEventTypeList.CLICK_EVENT

    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // Mode 1 shows the system exit dialog (required on the root page).
      void this.bridge.shutDownPageContainer(1)
      return
    }

    if (this.mode) {
      switch (type) {
        case OsEventTypeList.CLICK_EVENT:
          if (!this.mode.press?.()) void this.closeMode()
          break
        case OsEventTypeList.SCROLL_BOTTOM_EVENT:
          this.mode.swipe?.(1)
          break
        case OsEventTypeList.SCROLL_TOP_EVENT:
          this.mode.swipe?.(-1)
          break
        case OsEventTypeList.LONG_PRESS_EVENT:
          // Hold always means "talk": leave the mode first.
          void this.closeMode().then(() => this.listen())
          break
      }
      return
    }

    switch (type) {
      case OsEventTypeList.LONG_PRESS_EVENT:
        if (this.state !== 'thinking') void this.listen()
        break
      case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
        if (this.state === 'listening') void this.respond()
        break
      case OsEventTypeList.CLICK_EVENT:
        if (this.typing) this.skipTyping()
        else if (this.state === 'listening') void this.respond()
        else if (this.view === 'dashboard') void this.closeDashboard()
        else if (this.state === 'idle') void this.listen()
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (this.state === 'idle' && this.page < this.pages.length - 1) void this.showPage(this.page + 1)
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (this.state === 'idle' && this.page > 0) void this.showPage(this.page - 1)
        break
    }
  }

  /** Show a message as Jarvis's reply (also used for the boot greeting and errors). */
  async say(text: string) {
    this.view = 'answer'
    this.pages = paginate(text)
    await this.showPage(0)
  }

  // ── Views and modes ──────────────────────────────────────────────

  async run(action: Action) {
    this.asked = true
    // Views draw over the HUD layout, so leave any full-screen mode first.
    if (this.mode && ['dashboard', 'briefing', 'debrief', 'whatsnew', 'protocol', 'handsfree', 'persona', 'easter'].includes(action.type)) await this.closeMode()
    switch (action.type) {
      case 'dashboard':
        return this.openDashboard()
      case 'briefing':
        return this.showBriefing()
      case 'protocol':
        return this.setProtocol(action.name, action.minutes)
      case 'map':
        return this.enterMode(new MapMode(this.host))
      case 'radar':
        return this.enterMode(new RadarMode(this.host, action.category, RADAR_CATEGORIES[action.category]))
      case 'captions':
        return this.enterMode(new CaptionsMode(this.host, action.translate))
      case 'meeting':
        return this.enterMode(new MeetingMode(this.host))
      case 'teleprompter':
        return this.enterMode(action.follow ? new FollowTeleprompterMode(this.host) : new TeleprompterMode(this.host))
      case 'emergency':
        return this.enterMode(new EmergencyMode(this.host))
      case 'flashcards':
        return this.enterMode(new FlashcardMode(this.host, action.deck))
      case 'debrief':
        this.view = 'answer'
        void this.display.set(ID.header, 'DEBRIEF')
        return this.say(debrief({ agenda: this.agenda, lists: this.lists, expenses: this.expenses }))
      case 'whatsnew':
        return this.showWhatsNew()
      case 'navigate': {
        const cat = action.category && RADAR_CATEGORIES[action.category]
        return this.enterMode(new NavMode(this.host, action.query, cat ? { label: action.category!.replace('_', ' '), osmTag: cat } : undefined, action.to))
      }
      case 'guide':
        return this.enterMode(new GuideMode(this.host, action.topic))
      case 'list':
        return this.enterMode(new ListMode(this.host, action.name))
      case 'activity':
        return this.enterMode(new ActivityMode(this.host, action.kind))
      case 'diagnostics':
        return this.enterMode(new SuitMode(this.host))
      case 'handsfree':
        return this.setHandsFree(action.on)
      case 'persona':
        return this.setPersona(action.id)
      case 'easter':
        return this.easterEgg(action.id)
    }
  }

  private async enterMode(mode: Mode) {
    if (this.mode) await this.closeMode()
    this.skipTyping()
    this.stopSpin()
    this.state = 'idle'
    this.view = 'answer'
    // A mode that listens takes over the mic, so the wake listener steps aside without closing it.
    if (mode.audio && this.wake.active) await this.wake.stop(false)
    this.mode = mode
    try {
      await mode.enter()
    } catch (err) {
      console.error(`[mode] ${mode.name} failed`, err)
      if (this.mode === mode) await this.closeMode(`${mode.name} failed to start. My apologies.`)
    }
  }

  /** Leaves the active mode (restoring the HUD layout) and optionally shows a message. */
  async closeMode(text?: string, header?: string) {
    const mode = this.mode
    this.mode = null
    if (mode) await mode.exit().catch(() => {})
    if (this.display.layout !== 'hud') await this.display.setLayout('hud', HUD_CHROME)
    this.view = 'answer'
    await Promise.all([this.display.set(ID.header, header ?? this.banner), this.display.set(ID.footer, this.idleHint)])
    this.syncWake()
    if (text) await this.say(text)
    else await this.display.set(ID.body, ' ')
  }

  async openDashboard() {
    this.view = 'dashboard'
    void this.display.set(ID.header, 'DASHBOARD')
    const weather = this.dashboard.refreshWeather()
    this.pages = paginate(this.dashboard.render())
    this.lastDashboard = this.pages[0]
    await this.showPage(0)
    // Weather arrives after the first draw; tick() redraws with it.
    await weather
  }

  private async closeDashboard() {
    this.view = 'answer'
    this.pages = []
    await Promise.all([
      this.display.set(ID.header, this.banner),
      this.display.set(ID.body, ' '),
      this.display.set(ID.footer, this.idleHint),
    ])
  }

  private async showBriefing() {
    this.view = 'answer'
    void this.display.set(ID.header, 'DAILY BRIEFING')
    await this.say(await this.dashboard.briefing())
  }

  private async setProtocol(name: Protocol, minutes?: number) {
    this.protocol = name
    this.focusEndsAt = name === 'focus' ? Date.now() + Math.max(1, Math.min(180, minutes ?? 25)) * 60_000 : 0
    this.display.setTheme({ night: name === 'night', stealth: name === 'stealth' })
    void this.display.set(ID.header, this.banner)
    const lines: Record<Protocol, string> = {
      standard: 'Standard protocol. All systems visible.',
      focus: `Focus protocol for ${Math.round((this.focusEndsAt - Date.now()) / 60_000)} minutes. I'll hold the small stuff.`,
      night: 'Night protocol. Dimming the lights.',
      stealth: 'Stealth protocol. Minimal display.',
    }
    await this.say(lines[name])
  }

  private async setHandsFree(on: boolean) {
    if (on && !(await this.settings.get('groq'))) return this.say('Hands-free needs a Groq key. Add one in the phone app.')
    await this.settings.setHandsFree(on)
    this.handsFree = on
    this.syncWake()
    void this.display.set(ID.footer, this.idleHint)
    await this.say(
      on
        ? `Hands-free on. Start with my name, like "${this.persona === 'edith' ? 'EDITH' : this.persona.charAt(0).toUpperCase() + this.persona.slice(1)}, what's the time?" Skip the "hey": that wakes Even's own assistant. It uses more battery.`
        : 'Hands-free off. Hold the ring to talk.',
    )
  }

  private async setPersona(id: PersonaId) {
    await this.settings.setPersona(id)
    this.persona = id
    this.brain.reset()
    void this.display.set(ID.header, this.banner)
    void this.display.set(ID.footer, this.idleHint)
    const lines: Record<PersonaId, string> = {
      edith: 'E.D.I.T.H. online. Back to business.',
      friday: "F.R.I.D.A.Y. here. Grand to meet you properly.",
      jarvis: 'J.A.R.V.I.S. at your service. Shall we begin?',
    }
    await this.say(lines[id])
  }

  private async easterEgg(id: string) {
    this.view = 'answer'
    switch (id) {
      case 'house-party': {
        void this.display.set(ID.header, 'HOUSE PARTY PROTOCOL')
        let log = ''
        for (const mark of ['MARK 7', 'MARK 16', 'MARK 33', 'MARK 39', 'MARK 42']) {
          log += `> ${mark} ... ONLINE\n`
          await this.display.set(ID.body, log)
          await sleep(220)
        }
        await sleep(500)
        await this.say("All suits accounted for. They're imaginary, but the enthusiasm is real.")
        break
      }
      case 'clean-slate':
        void this.display.set(ID.header, 'CLEAN SLATE PROTOCOL')
        await this.say('Display wiped. Nothing to see here.')
        await sleep(1500)
        this.pages = []
        await this.display.set(ID.body, ' ')
        void this.display.set(ID.header, this.banner)
        break
      case 'iron-man':
        return this.enterMode(new IronManMode(this.host))
      case 'self-destruct':
        void this.display.set(ID.header, '● SELF DESTRUCT ●')
        for (const n of ['3', '2', '1']) {
          await this.display.set(ID.body, n)
          await sleep(700)
        }
        await this.say('Self-destruct requires two-factor authentication. Crisis averted.')
        void this.display.set(ID.header, this.banner)
        break
      default:
        await this.say(`Always. ${this.name} is listening.`)
    }
  }

  // ── Once a second ────────────────────────────────────────────────

  private async tick() {
    this.mode?.tick?.()
    const now = Date.now()
    if (this.live) {
      this.syncWake()
      void this.calendar.sync().catch(() => {})
    }

    const due = await this.agenda.takeDue()
    for (const t of due.timers) this.alerts.push(`Your ${t.label === 'timer' ? '' : t.label + ' '}timer is done.`)
    for (const r of due.reminders) this.alerts.push(`Reminder: ${r.text}`)

    if (this.protocol === 'focus') {
      if (now >= this.focusEndsAt) {
        this.alerts.push('Focus session complete. Take five.')
        this.protocol = 'standard'
      } else if (!this.mode && this.view === 'answer' && this.state === 'idle') {
        void this.display.set(ID.header, this.banner)
      }
    } else {
      // Heads-up before events, held back during focus.
      for (const e of await this.agenda.takeUpcoming(NUDGE_LEAD_MS, now)) this.alerts.push(this.proactive.brief(e, now))
      void this.maybeBriefing(now)
    }
    // Rain, leave-now and location reminders (each check paces itself).
    if (this.live) void this.proactive.check(now).then((a) => this.alerts.push(...a))

    const idle = !this.mode && this.state === 'idle' && !this.typing && !this.alerting
    if (this.alerts.length && idle) {
      void this.showAlerts()
      return
    }
    if (this.view === 'dashboard' && idle) {
      const pages = paginate(this.dashboard.render())
      if (pages.length !== this.pages.length) void this.footerFor(this.page)
      this.pages = pages
      this.page = Math.min(this.page, pages.length - 1)
      // Only send when something changed (the clock ticks per minute; timers per second).
      if (pages[this.page] !== this.lastDashboard) {
        this.lastDashboard = pages[this.page]
        void this.display.set(ID.body, this.lastDashboard)
      }
      void this.dashboard.refreshWeather()
    }
  }

  private async maybeBriefing(now: number) {
    if (this.briefingCheck || this.mode || this.state !== 'idle' || this.typing) return
    this.briefingCheck = true
    try {
      const time = await this.settings.briefingTime()
      if (!/^\d{1,2}:\d{2}$/.test(time)) return
      const [h, m] = time.split(':').map(Number)
      const at = new Date(now)
      at.setHours(h, m, 0, 0)
      const today = new Date(now).toDateString()
      // Once a day, within two hours of the set time (the app may not be open at that exact minute).
      if (now < at.getTime() || now > at.getTime() + 2 * 3600_000) return
      if ((await this.settings.getState('lastBriefing')) === today) return
      await this.settings.setState('lastBriefing', today)
      await this.showBriefing()
    } finally {
      this.briefingCheck = false
    }
  }

  private async showAlerts() {
    this.alerting = true
    // Blink the header so an alert is noticed even mid-glance.
    for (let i = 0; i < 3; i++) {
      await this.display.set(ID.header, '● ALERT ●')
      await sleep(250)
      await this.display.set(ID.header, ' ')
      await sleep(150)
    }
    void this.display.set(ID.header, '● ALERT ●')
    await this.say(this.alerts.splice(0).join('\n'))
    void this.display.set(ID.header, this.banner)
    this.alerting = false
  }

  // ── Device status ────────────────────────────────────────────────

  private statusLine() {
    const s = this.device
    if (!s || s.batteryLevel == null) return ''
    const extra = s.isCharging ? ' · CHARGING' : s.isWearing === false ? ' · NOT WORN' : ''
    return `G2 ${s.batteryLevel}%${extra}`
  }

  private deviceSummary(): Record<string, unknown> {
    const s = this.device
    if (!s) return { error: 'No status from the glasses yet.' }
    return { batteryPercent: s.batteryLevel, charging: s.isCharging, wearing: s.isWearing, inCase: s.isInCase, connection: String(s.connectType) }
  }

  /** Suit diagnostics lines. Phone battery and network come from the WebView where it exposes them (Android does; iOS doesn't). */
  private async diagnostics(): Promise<string[]> {
    const lines: string[] = []
    const s = this.device
    lines.push(
      s?.batteryLevel != null
        ? `G2    ${bar(s.batteryLevel)} ${s.batteryLevel}%${s.isCharging ? ' CHG' : s.isWearing === false ? ' OFF' : ''}`
        : 'G2    NO TELEMETRY',
    )
    try {
      const b = await (navigator as any).getBattery?.()
      lines.push(b ? `PHONE ${bar(b.level * 100)} ${Math.round(b.level * 100)}%${b.charging ? ' CHG' : ''}` : 'PHONE NO TELEMETRY')
    } catch {
      lines.push('PHONE NO TELEMETRY')
    }
    const conn = (navigator as any).connection
    lines.push(`NET   ${navigator.onLine ? 'ONLINE' : 'OFFLINE'}${conn?.effectiveType ? ` · ${String(conn.effectiveType).toUpperCase()}` : ''}`)
    const fix = await this.locator.get(60_000)
    lines.push(fix ? `GPS   ${fix.source === 'phone' ? 'PHONE' : fix.source === 'browser' ? 'BROWSER' : 'HOME CITY'}${fix.accuracy ? ` ±${Math.round(fix.accuracy)}m` : ''}` : 'GPS   NO FIX')
    const keys = await this.settings.all()
    lines.push(`VOICE ${keys.groq ? `${bar(100 - this.usage.fraction * 100)} ${Math.round(100 - this.usage.fraction * 100)}% QUOTA` : 'NO KEY'}`)
    lines.push(`CORE  ${keys.gemini ? 'GEMINI ONLINE' : 'NO KEY'}`)
    lines.push(`WAKE  ${this.handsFree ? (this.wake.active ? 'ARMED' : 'PAUSED') : 'OFF'}`)
    lines.push(`CAL   ${(await this.calendar.linked()) ? (this.calendar.lastError ? 'GOOGLE · SYNC FAILED' : 'GOOGLE LINKED') : 'LOCAL ONLY'}`)
    lines.push(`AI    ${this.name} · ${this.protocol.toUpperCase()}`)
    return lines
  }

  // ── Hands-free ───────────────────────────────────────────────────

  /** Keeps the wake listener running exactly when it should own the mic. */
  private syncWake() {
    const want = this.live && this.handsFree && this.state !== 'listening' && !this.mode?.audio && !this.recorder.recording
    if (want && !this.wake.active) void this.wake.start().catch((err) => console.warn('[wake] mic failed', err))
    else if (!want && this.wake.active && !this.recorder.recording && !this.mode?.audio) void this.wake.stop(true)
  }

  private async onUtterance(u: Utterance) {
    if (this.wakeBusy || this.state !== 'idle') return
    // Spread checks out; a dropped burst just means saying it again.
    if (Date.now() - this.lastWakeRequest < WAKE_GAP_MS) return
    if (this.usage.fraction > 0.95) {
      this.handsFree = false
      this.syncWake()
      this.alerts.push("Hands-free paused: today's free Groq quota is nearly used up. Hold the ring to talk.")
      return
    }
    const key = await this.settings.get('groq')
    if (!key) return
    this.wakeBusy = true
    this.lastWakeRequest = Date.now()
    try {
      const said = await transcribe(u.wav, key, { prompt: WAKE_PROMPT })
      await this.usage.add(u.seconds)
      const command = matchWake(said)
      console.log(`[wake] "${said}" →`, command === null ? 'no wake' : `"${command}"`)
      if (command === null || this.state !== 'idle') return
      if (command.split(/\s+/).filter(Boolean).length >= 2) {
        // "Jarvis, what's the weather" in one breath: answer it directly.
        await this.handleText(command)
      } else {
        if (this.mode) await this.closeMode()
        await this.listen(true)
      }
    } catch (err) {
      console.warn('[wake] check failed', err)
    } finally {
      this.wakeBusy = false
    }
  }

  // ── Talking ──────────────────────────────────────────────────────

  /** `auto`: started by the wake word, so stop by itself when the speaker goes quiet. */
  private async listen(auto = false) {
    this.skipTyping()
    this.state = 'listening'
    this.view = 'answer'
    this.waveform.reset()
    if (this.wake.active) await this.wake.stop(false)
    await Promise.all([
      this.display.set(ID.header, 'LISTENING'),
      this.display.set(ID.body, ' '),
      this.display.set(ID.footer, this.waveform.render()),
    ])
    try {
      await this.recorder.start(auto ? () => void this.respond() : undefined)
    } catch (err) {
      console.error(err)
      this.state = 'idle'
      await this.finish('My microphone is unavailable. Do check the glasses are connected.')
    }
  }

  private async respond() {
    if (this.state !== 'listening') return
    this.state = 'thinking'
    const audio = await this.recorder.stop()
    console.log(`[voice] ${audio.seconds.toFixed(1)}s, peak ${audio.peak.toFixed(3)}`)
    // Skip the upload for taps and near-silence; Whisper invents words for silence.
    if (audio.seconds < 0.4 || audio.peak < 0.008) return this.finish("I didn't catch that.")

    const groqKey = await this.settings.get('groq')
    if (!groqKey) return this.finish('I need a Groq key before I can hear you. Add one in the phone app.')

    this.spin('TRANSCRIBING')
    let question: string
    try {
      question = await transcribe(audio.wav, groqKey)
      await this.usage.add(audio.seconds)
    } catch (err) {
      return this.finish(explain(err, 'Groq'))
    }
    console.log(`[voice] heard: ${question}`)
    if (isNoise(question)) return this.finish("I didn't catch that.")
    return this.handleText(question)
  }

  /** Runs a transcribed or typed request (the phone remote calls this too). */
  async handleText(question: string) {
    this.asked = true
    if (this.mode) await this.closeMode()
    this.state = 'thinking'
    const command = normalise(question)
    const fast = FAST.find(([re]) => re.test(command))?.[1]
    if (fast) {
      this.stopSpin()
      this.state = 'idle'
      return fast === 'close' ? this.closeDashboard() : this.run(fast)
    }

    void this.display.set(ID.header, `» ${truncate(question, 34)}`)
    // "I spent £12 on lunch" logs locally: instant, and works with no signal.
    const spent = parseExpense(question)
    if (spent) {
      const e = await this.expenses.add(spent.amount, spent.what, spent.currency)
      return this.finish(`Logged ${money(e.amount, e.currency)} for ${e.what}. Today: ${this.expenses.total(this.expenses.since(periodStart('today')))}.`, true)
    }
    // Simple maths answers locally: instant, exact, and works with no signal.
    const quick = quickAnswer(question)
    if (quick) return this.finish(quick, true)

    this.spin('THINKING')
    try {
      const reply = await this.brain.ask(question)
      const action = reply.actions[reply.actions.length - 1]
      if (action) {
        this.stopSpin()
        this.state = 'idle'
        return this.run(action)
      }
      return this.finish(reply.text || 'I have nothing useful to add, which is rare.', true)
    } catch (err) {
      console.error(err)
      // No connection: answer from what's on the phone if the question allows it.
      if (err instanceof ApiError && (err.kind === 'blocked' || err.kind === 'timeout')) {
        const local = offlineAnswer(command, { agenda: this.agenda, lists: this.lists, dashboard: this.dashboard })
        if (local) return this.finish(`${local}\n(Offline: from the phone.)`, true)
      }
      return this.finish(explain(err, 'Gemini'))
    }
  }

  private async finish(text: string, keepQuestion = false) {
    this.stopSpin()
    this.state = 'idle'
    if (!keepQuestion) void this.display.set(ID.header, this.banner)
    void this.display.set(ID.footer, this.idleHint)
    this.syncWake()
    await this.say(text)
  }

  private footerFor(n: number) {
    const hint = this.view === 'dashboard' ? 'PRESS · CLOSE' : this.idleHint
    return this.display.set(ID.footer, this.pages.length > 1 ? `PAGE ${n + 1}/${this.pages.length} · SWIPE` : hint)
  }

  private async showPage(n: number) {
    this.typing?.skip()
    this.page = n
    void this.footerFor(n)
    const t = typewrite(this.display, ID.body, this.pages[n])
    this.typing = t
    await t.done
    if (this.typing === t) this.typing = null
  }

  private skipTyping() {
    const t = this.typing
    this.typing = null
    t?.skip()
  }

  private spin(label: string) {
    this.stopSpin()
    let n = 0
    const tick = () => void this.display.set(ID.footer, `${label} ${'·'.repeat((n++ % 3) + 1)}`)
    tick()
    this.spinner = setInterval(tick, 350)
  }

  private stopSpin() {
    clearInterval(this.spinner)
    this.spinner = undefined
  }
}

/** Lowercase, no punctuation, and no leading "Jarvis," so "Jarvis, open dashboard." matches. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |okay )?(?:edith|edit|jarvis|friday)\s*/, '')

/** Dry, in-character error lines that still say what to fix. */
function explain(err: unknown, service: string): string {
  const kind = err instanceof ApiError ? err.kind : 'http'
  switch (kind) {
    case 'blocked':
      return `I can't reach ${service}. Check the phone's connection.`
    case 'timeout':
      return `${service} is taking its time. Try again in a moment.`
    case 'key':
      return `${service} rejected my key. Check it in the phone app.`
    case 'rate':
      return `${service} asks that we slow down. Try again in a minute.`
    case 'server':
      return `${service} is having a bad day. Try again shortly.`
    default:
      return `Something went wrong with ${service}. My apologies.`
  }
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3) + '...' : s)
