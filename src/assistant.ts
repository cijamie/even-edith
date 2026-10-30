import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Display } from './hud/display'
import { ID } from './hud/layout'
import { sleep, typewrite, type Typing } from './hud/typewriter'
import { paginate } from './hud/paginate'
import { Waveform } from './hud/waveform'
import { Dashboard } from './hud/dashboard'
import { Recorder } from './voice/recorder'
import { isNoise, transcribe } from './net/groq'
import { Brain } from './net/gemini'
import { ApiError } from './net/http'
import type { Agenda } from './data/agenda'
import type { Settings } from './settings'

type State = 'idle' | 'listening' | 'thinking'
type View = 'answer' | 'dashboard'

const BANNER = 'J.A.R.V.I.S // ONLINE'
const IDLE_HINT = 'HOLD · TALK'

// Handled locally so the dashboard opens instantly, without a round trip to Gemini.
const OPEN_DASHBOARD = /^(?:(?:please|can you|could you)\s+)?(?:open|show|bring up|display|pull up)(?: me)?(?: the| my)? dashboard\b/
const CLOSE_DASHBOARD = /^(?:close|hide|dismiss)(?: the| my)? dashboard\b/

/**
 * Ring-to-talk loop: hold to record, release to transcribe (Groq Whisper),
 * ask (Gemini), then type the answer out with swipe paging.
 * A single press also starts/stops listening, as a fallback for long press.
 * Also owns the dashboard view and fires timer/reminder alerts.
 */
export class Assistant {
  private state: State = 'idle'
  private view: View = 'answer'
  private pages: string[] = []
  private page = 0
  private typing: Typing | null = null
  private waveform = new Waveform()
  private recorder: Recorder
  private brain: Brain
  private dashboard: Dashboard
  private spinner: ReturnType<typeof setInterval> | undefined
  private alerts: string[] = []
  private alerting = false
  private lastDashboard = ''

  constructor(
    private bridge: EvenAppBridge,
    private display: Display,
    private settings: Settings,
    private agenda: Agenda,
  ) {
    this.recorder = new Recorder(bridge, (level) => void this.display.set(ID.footer, this.waveform.push(level)))
    this.brain = new Brain(() => settings.get('gemini'), { agenda, settings })
    this.dashboard = new Dashboard(agenda, settings)
    setInterval(() => void this.tick(), 1000)
  }

  handle(event: EvenHubEvent) {
    if (event.audioEvent) {
      this.recorder.push(event.audioEvent.audioPcm)
      return
    }
    // Gestures can arrive on textEvent or sysEvent (the simulator uses sysEvent),
    // and CLICK_EVENT (0) is often dropped, leaving eventType undefined.
    const src = event.textEvent ?? event.sysEvent
    if (!src) return
    switch (src.eventType ?? OsEventTypeList.CLICK_EVENT) {
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
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Mode 1 shows the system exit dialog (required on the root page).
        void this.bridge.shutDownPageContainer(1)
        break
    }
  }

  /** Show a message as Jarvis's reply (also used for the boot greeting and errors). */
  async say(text: string) {
    this.view = 'answer'
    this.pages = paginate(text)
    await this.showPage(0)
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
      this.display.set(ID.header, BANNER),
      this.display.set(ID.body, ' '),
      this.display.set(ID.footer, IDLE_HINT),
    ])
  }

  /** Once a second: fire due alerts, and keep the dashboard's clock and timers live. */
  private async tick() {
    const due = await this.agenda.takeDue()
    for (const t of due.timers) this.alerts.push(`Your ${t.label === 'timer' ? '' : t.label + ' '}timer is done, sir.`)
    for (const r of due.reminders) this.alerts.push(`Reminder: ${r.text}`)
    if (this.alerts.length && this.state === 'idle' && !this.typing && !this.alerting) {
      void this.showAlerts()
      return
    }
    if (this.view === 'dashboard' && this.state === 'idle' && !this.typing) {
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

  private async showAlerts() {
    this.alerting = true
    const wasDashboard = this.view === 'dashboard'
    // Blink the header so an alert is noticed even mid-glance.
    for (let i = 0; i < 3; i++) {
      await this.display.set(ID.header, '● ALERT ●')
      await sleep(250)
      await this.display.set(ID.header, ' ')
      await sleep(150)
    }
    void this.display.set(ID.header, '● ALERT ●')
    const text = this.alerts.splice(0).join('\n')
    await this.say(text)
    void this.display.set(ID.header, BANNER)
    this.alerting = false
    // Leave the alert on screen; the dashboard comes back on the next open.
    if (wasDashboard) this.view = 'answer'
  }

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
    } catch (err) {
      return this.finish(explain(err, 'Groq'))
    }
    console.log(`[voice] heard: ${question}`)
    if (isNoise(question)) return this.finish("I didn't catch that.")
    return this.handleText(question)
  }

  /** Runs a transcribed (or typed) request. Exposed for testing without a mic. */
  async handleText(question: string) {
    this.state = 'thinking'
    const command = normalise(question)
    if (OPEN_DASHBOARD.test(command)) {
      this.stopSpin()
      this.state = 'idle'
      return this.openDashboard()
    }
    if (CLOSE_DASHBOARD.test(command)) {
      this.stopSpin()
      this.state = 'idle'
      return this.closeDashboard()
    }

    void this.display.set(ID.header, `» ${truncate(question, 34)}`)
    this.spin('THINKING')
    try {
      const reply = await this.brain.ask(question)
      if (reply.actions.has('dashboard')) {
        this.stopSpin()
        this.state = 'idle'
        return this.openDashboard()
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
    if (!keepQuestion) void this.display.set(ID.header, BANNER)
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

/** Lowercase, no punctuation, and no leading "Jarvis," so "Jarvis, open dashboard." matches. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:hey |ok |okay )?jarvis\s*/, '')

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
