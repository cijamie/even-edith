import './phone/style.css'
import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { runProbe } from './probe'
import { Settings } from './settings'
import { mountKeys } from './phone/keys-ui'
import { mountDiagnostics } from './phone/diagnostics-ui'
import { Display } from './hud/display'
import { createHud, ID, NAMES } from './hud/layout'
import { boot } from './hud/boot'
import { Assistant } from './assistant'

const status = document.getElementById('status')!

const bridge = await waitForEvenAppBridge()
const settings = new Settings(bridge)

// The phone UI works even when no glasses are connected (desktop browser, Pages).
let onKeysChanged = () => {}
await mountKeys(document.getElementById('keys')!, settings, () => onKeysChanged())
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
  if (!missing.length) return 'At your service. Hold to speak.'
  const [noun, pronoun] = missing.length > 1 ? ['keys', 'them'] : ['key', 'it']
  return `I appear to be missing my ${missing.join(' and ')} ${noun}, sir. Open Even Jarvis on your phone to add ${pronoun}.`
}

async function startHud(bridge: EvenAppBridge) {
  await createHud(bridge)
  const display = new Display(bridge, NAMES)
  const assistant = new Assistant(bridge, display, settings)

  let ready = false
  bridge.onEvenHubEvent((event) => {
    if (ready) assistant.handle(event)
  })
  onKeysChanged = () => {
    if (ready) void greeting().then((text) => assistant.say(text))
  }

  const keys = await settings.all()
  await boot(
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
}
