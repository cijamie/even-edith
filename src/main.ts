import './phone/style.css'
import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { runProbe } from './probe'
import { Store } from './store'
import { Settings } from './settings'
import { Agenda } from './data/agenda'
import { mountKeys } from './phone/keys-ui'
import { mountPrefs } from './phone/prefs-ui'
import { mountDiagnostics } from './phone/diagnostics-ui'
import { Display } from './hud/display'
import { createHud, ID, NAMES } from './hud/layout'
import { boot } from './hud/boot'
import { Assistant } from './assistant'

const status = document.getElementById('status')!

const bridge = await waitForEvenAppBridge()
const store = new Store(bridge)
await store.migrate({
  'jarvis.geminiKey': 'edith.geminiKey',
  'jarvis.groqKey': 'edith.groqKey',
  'jarvis.homeCity': 'edith.homeCity',
  'jarvis.agenda': 'edith.agenda',
})
const settings = new Settings(store)
const agenda = new Agenda(store)
await agenda.load()

// The phone UI works even when no glasses are connected (desktop browser, Pages).
let onSettingsChanged = () => {}
await mountKeys(document.getElementById('keys')!, settings, () => onSettingsChanged())
await mountPrefs(document.getElementById('prefs')!, settings, () => onSettingsChanged())
mountDiagnostics(document.getElementById('diagnostics')!, settings)

if (new URLSearchParams(location.search).has('probe')) {
  await runProbe(bridge)
} else {
  startHud(bridge).then(
    () => (status.textContent = 'Glasses connected.'),
    (err) => {
      console.warn(err)
      status.textContent = 'Glasses not connected. Settings still save on this device.'
    },
  )
}

async function greeting() {
  const keys = await settings.all()
  const missing = [!keys.groq && 'Groq', !keys.gemini && 'Gemini'].filter(Boolean)
  if (!missing.length) return 'All systems nominal. Hold to speak.'
  const [noun, pronoun] = missing.length > 1 ? ['keys', 'them'] : ['key', 'it']
  return `I'm missing my ${missing.join(' and ')} ${noun}. Open Even EDITH on your phone to add ${pronoun}.`
}

async function startHud(bridge: EvenAppBridge) {
  await createHud(bridge)
  const display = new Display(bridge, NAMES)
  const assistant = new Assistant(bridge, display, settings, agenda)
  // Dev hook: drive the assistant by text from the console, e.g. edith.handleText('open dashboard').
  if (import.meta.env.DEV) Object.assign(window, { edith: assistant })

  let ready = false
  bridge.onEvenHubEvent((event) => {
    if (ready) assistant.handle(event)
  })
  onSettingsChanged = () => {
    if (ready) void greeting().then((text) => assistant.say(text))
  }

  const keys = await settings.all()
  await boot(
    bridge,
    display,
    [
      { label: 'CORE SYSTEMS', ok: true },
      { label: 'VOICE UPLINK  [GROQ]', ok: !!keys.groq },
      { label: 'NEURAL CORE  [GEMINI]', ok: !!keys.gemini },
    ],
    await greeting(),
  )
  await display.set(ID.footer, 'HOLD · TALK')
  ready = true

  // Dev-only test hooks for the simulator: ?seed adds sample items, ?say=... runs a phrase as if spoken.
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search)
    if (params.has('seed')) {
      const now = Date.now()
      await agenda.addTimer(250, 'pasta')
      await agenda.addTimer(8, 'tea')
      await agenda.addReminder('Call mum', now + 2 * 3600_000)
      await agenda.addEvent('Design review', now + 3600_000)
      await agenda.addEvent('Dentist', now + 20 * 3600_000)
      await agenda.addNote('Buy coffee and oat milk')
      if (!(await settings.homeCity())) await settings.setHomeCity('London')
    }
    const say = params.get('say')
    if (say) await assistant.handleText(say)
  }
}
