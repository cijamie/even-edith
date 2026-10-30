import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent, type DeviceStatus } from '@evenrealities/even_hub_sdk'
import type { Display } from './hud/display'
import { GLYPHS, ID } from './hud/layout'
import { sleep, typewrite, type Typing } from './hud/typewriter'
import { paginate } from './hud/paginate'
import { Waveform } from './hud/waveform'
import { Dashboard } from './hud/dashboard'
import { Recorder } from './voice/recorder'
import { isNoise, transcribe, type GroqUsage } from './net/groq'
import { Brain } from './net/gemini'
import { ApiError } from './net/http'
import type { Agenda } from './data/agenda'
import type { Memory } from './data/memory'
import type { Locator } from './geo/location'
import type { Settings } from './settings'
import { RADAR_CATEGORIES, type Action, type Protocol } from './tools'
import type { Host, Mode } from './modes/mode'
import { CaptionsMode } from './modes/captions'
import { MeetingMode } from './modes/meeting'
import { TeleprompterMode } from './modes/teleprompter'
import { MapMode, RadarMode } from './modes/map'
import { clock, countdown } from './util/time'

type State = 'idle' | 'listening' | 'thinking'
type View = 'answer' | 'dashboard'

const IDLE_HINT = 'HOLD · TALK'
const HUD_CHROME = { [ID.tl]: GLYPHS.tl, [ID.tr]: GLYPHS.tr, [ID.bl]: GLYPHS.bl, [ID.br]: GLYPHS.br }
const NUDGE_LEAD_MS = 10 * 60_000

// Handled locally so these open instantly, without a round trip to Gemini.
const FAST: [RegExp, Action | 'close'][] = [
  [/^(?:(?:please|can you|could you)\s+)?(?:open|show|bring up|display|pull up)(?: me)?(?: the| my)? dashboard\b/, { type: 'dashboard' }],
  [/^(?:(?:please|can you|could you)\s+)?(?:open|show)(?: me)?(?: the| a| my)? map\b|^where am i\b/, { type: 'map' }],
  [/^(?:start |open |turn on )?(?:live )?(?:captions|subtitles)\b/, { type: 'captions', translate: false }],
  [/^(?:start |open )?(?:translat(?:e|ion|or))(?: mode)?$/, { type: 'captions', translate: true }],
  [/^(?:open |start )?(?:the )?teleprompter\b/, { type: 'teleprompter' }],
  [/^(?:start |record )(?:a |the )?meeting\b|^meeting mode\b/, { type: 'meeting' }],
  [/^(?:close|hide|dismiss|exit)\b|^stop$/, 'close'],
]

/**
 * Ring-to-talk loop: hold to record, release to transcribe (Groq Whisper),
 * ask (Gemini), then type the answer out with swipe paging. A single press also
 * starts/stops listening, as a fallback for long press.
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

  constructor(
    private bridge: EvenAppBridge,
    private display: Display,
    private settings: Settings,
    private agenda: Agenda,
    memory: Memory,
    locator: Locator,
    usage: GroqUsage,
  ) {
    this.recorder = new Recorder(bridge, (level) => void this.display.set(ID.footer, this.waveform.push(level)))
    this.brain = new Brain(() => settings.get('gemini'), {
      agenda,
      settings,
      memory,
      locator,
      deviceStatus: () => this.deviceSummary(),
    })
    this.dashboard = new Dashboard(agenda, settings, () => this.statusLine())
    this.host = {
      bridge,
      display,
      settings,
      agenda,
      brain: this.brain,
      locator,
      usage,
      finish: (text, header) => this.closeMode(text, header),
    }
    void bridge
      .getDeviceInfo()
      .then((info) => (this.device = info?.status ?? null))
      .catch(() => {})
    bridge.onDeviceStatusChanged((s) => (this.device = s))
    setInterval(() => void this.tick(), 1000)
  }

  get banner() {
    if (this.protocol === 'focus') return `FOCUS · ${countdown((this.focusEndsAt - Date.now()) / 1000)}`
    if (this.protocol === 'night') return 'E.D.I.T.H. // NIGHT'
    return 'E.D.I.T.H. // ONLINE'
  }

  get activeMode() {
    return this.mode?.name ?? (this.view === 'dashboard' ? 'dashboard' : null)
  }

  handle(event: EvenHubEvent) {
    if (event.audioEvent) {
      if (this.mode?.audio) this.mode.audio(event.audioEvent.audioPcm)
      else this.recorder.push(event.audioEvent.audioPcm)
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

  /** Show a message as EDITH's reply (also used for the boot greeting and errors). */
  async say(text: string) {
    this.view = 'answer'
    this.pages = paginate(text)
    await this.showPage(0)
  }

  // ── Views and modes ──────────────────────────────────────────────

  async run(action: Action) {
    // Views draw over the HUD layout, so leave any full-screen mode first.
    if (this.mode && ['dashboard', 'briefing', 'protocol'].includes(action.type)) await this.closeMode()
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
        return this.enterMode(new TeleprompterMode(this.host))
    }
  }

  private async enterMode(mode: Mode) {
    if (this.mode) await this.closeMode()
    this.skipTyping()
    this.stopSpin()
    this.state = 'idle'
    this.view = 'answer'
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
    await Promise.all([this.display.set(ID.header, header ?? this.banner), this.display.set(ID.footer, IDLE_HINT)])
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
      this.display.set(ID.footer, IDLE_HINT),
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

  // ── Once a second ────────────────────────────────────────────────

  private async tick() {
    this.mode?.tick?.()
    const now = Date.now()

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
      for (const e of await this.agenda.takeUpcoming(NUDGE_LEAD_MS, now)) {
        this.alerts.push(`${e.title} at ${clock(e.start)}, in ${Math.max(1, Math.round((e.start - now) / 60_000))} minutes.`)
      }
      void this.maybeBriefing(now)
    }

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

  // ── Talking ──────────────────────────────────────────────────────

  private async listen() {
    this.skipTyping()
    this.state = 'listening'
    this.view = 'answer'
    this.waveform.reset()
    await Promise.all([
      this.display.set(ID.header, 'LISTENING'),
      this.display.set(ID.body, ' '),
      this.display.set(ID.footer, this.waveform.render()),
    ])
    try {
      await this.recorder.start()
    } catch (err) {
      console.error(err)
      this.state = 'idle'
      await this.finish('My microphone is unavailable. Do check the glasses are connected.')
    }
  }

  private async respond() {
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
      await this.host.usage.add(audio.seconds)
    } catch (err) {
      return this.finish(explain(err, 'Groq'))
    }
    console.log(`[voice] heard: ${question}`)
    if (isNoise(question)) return this.finish("I didn't catch that.")
    return this.handleText(question)
  }

  /** Runs a transcribed or typed request (the phone remote calls this too). */
  async handleText(question: string) {
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
      return this.finish(explain(err, 'Gemini'))
    }
  }

  private async finish(text: string, keepQuestion = false) {
    this.stopSpin()
    this.state = 'idle'
    if (!keepQuestion) void this.display.set(ID.header, this.banner)
    await this.say(text)
  }

  private footerFor(n: number) {
    const hint = this.view === 'dashboard' ? 'PRESS · CLOSE' : IDLE_HINT
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

/** Lowercase, no punctuation, and no leading "EDITH," so "EDITH, open dashboard." matches. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |okay )?(?:edith|edit|jarvis)\s*/, '')

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
