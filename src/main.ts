import './phone/style.css'
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { runProbe } from './probe'
import { Store } from './store'
import { Settings } from './settings'
import { Agenda } from './data/agenda'
import { Memory } from './data/memory'
import { Flashcards } from './data/flashcards'
import { Locator } from './geo/location'
import { GroqUsage } from './net/groq'
import { setLocator } from './net/diagnostics'
import { mountKeys } from './phone/keys-ui'
import { mountPrefs } from './phone/prefs-ui'
import { mountDiagnostics } from './phone/diagnostics-ui'
import { mountMirror } from './phone/mirror-ui'
import { mountTeleprompter } from './phone/teleprompter-ui'
import { mountMemory } from './phone/memory-ui'
import { mountLists } from './phone/lists-ui'
import { mountFlashcards } from './phone/flashcards-ui'
import { mountRelay } from './phone/relay-ui'
import { Display } from './hud/display'
import { ID } from './hud/layout'
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
const memory = new Memory(store)
const flashcards = new Flashcards(store)
const usage = new GroqUsage(store)
await Promise.all([agenda.load(), memory.load(), flashcards.load(), usage.load()])
const locator = new Locator(bridge, settings)
setLocator(() => locator.get(0))

if (new URLSearchParams(location.search).has('probe')) {
  await runProbe(bridge)
} else {
  const display = new Display(bridge)
  const assistant = new Assistant(bridge, display, settings, agenda, memory, flashcards, locator, usage)
  // Dev hook: drive the assistant from the console, e.g. edith.handleText('open dashboard').
  if (import.meta.env.DEV) Object.assign(window, { edith: assistant })

  let ready = false
  bridge.onEvenHubEvent((event) => {
    if (ready) assistant.handle(event)
  })

  const startBoot = async () => {
    ready = false
    const connected = await display.setLayout('boot', {}, true)
    status.textContent = connected
      ? 'Glasses connected.'
      : 'Glasses not connected. The mirror shows what they would display; settings still save on this device.'
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

  // Phone UI. Works without glasses too (desktop browser, GitHub Pages).
  mountMirror(document.getElementById('mirror')!, display, {
    event: (e) => ready && assistant.handle(e),
    say: (text) => ready && void assistant.handleText(text),
    action: (a) => ready && void assistant.run(a),
    replayBoot: () => ready && void assistant.closeMode().then(startBoot),
  })
  const onSettingsChanged = () => ready && void greeting().then((text) => assistant.say(text))
  await mountKeys(document.getElementById('keys')!, settings, onSettingsChanged)
  await mountPrefs(document.getElementById('prefs')!, settings, () => {})
  await mountTeleprompter(document.getElementById('teleprompter')!, settings, () => ready && void assistant.run({ type: 'teleprompter' }))
  mountLists(document.getElementById('lists')!, agenda)
  mountFlashcards(document.getElementById('flashcards')!, flashcards, (deck) => ready && void assistant.run({ type: 'flashcards', deck }))
  mountMemory(document.getElementById('memory')!, memory)
  await mountRelay(document.getElementById('relay')!, settings)
  mountDiagnostics(document.getElementById('diagnostics')!, settings)

  await startBoot()

  // Dev-only test hooks for the simulator: ?seed adds sample items, ?say=... runs a phrase as if spoken.
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search)
    if (params.has('seed')) {
      const now = Date.now()
      await agenda.addTimer(250, 'pasta')
      await agenda.addReminder('Call mum', now + 2 * 3600_000)
      await agenda.addEvent('Design review', now + 3600_000)
      await agenda.addNote('Buy coffee and oat milk')
      await agenda.addToList('shopping', ['coffee', 'oat milk', 'eggs'])
      await agenda.addReminder('Stand-up', now + 20 * 3600_000, 'weekdays')
      await flashcards.add('spanish', [
        { front: 'la manzana', back: 'the apple' },
        { front: 'el pan', back: 'the bread' },
        { front: 'la leche', back: 'the milk' },
      ])
      if (!(await settings.homeCity())) await settings.setHomeCity('London')
    }
    const say = params.get('say')
    if (say) await assistant.handleText(say)
  }
}

async function greeting() {
  const keys = await settings.all()
  const missing = [!keys.groq && 'Groq', !keys.gemini && 'Gemini'].filter(Boolean)
  if (!missing.length) return 'All systems nominal. Hold to speak.'
  const [noun, pronoun] = missing.length > 1 ? ['keys', 'them'] : ['key', 'it']
  return `I'm missing my ${missing.join(' and ')} ${noun}. Open Even EDITH on your phone to add ${pronoun}.`
}
