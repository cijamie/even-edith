import type { Settings } from '../settings'
import { PERSONA_IDS, PERSONAS } from '../persona'

type Pref = {
  id: string
  label: string
  type: string
  placeholder: string
  empty: string
  get: () => Promise<string>
  set: (v: string) => Promise<void>
}

/** Personality, hands-free, home city (weather, map fallback) and the daily briefing time. */
export async function mountPrefs(root: HTMLElement, settings: Settings, onChange: () => void) {
  const prefs: Pref[] = [
    {
      id: 'home-city',
      label: 'Home city',
      type: 'text',
      placeholder: 'e.g. London',
      empty: 'NOT SET',
      get: () => settings.homeCity(),
      set: (v) => settings.setHomeCity(v),
    },
    {
      id: 'briefing-time',
      label: 'Daily briefing',
      type: 'time',
      placeholder: '07:30',
      empty: 'OFF',
      get: () => settings.briefingTime(),
      set: (v) => settings.setBriefingTime(v),
    },
  ]

  // Personality and hands-free apply instantly, no Save button.
  const extra = document.createElement('div')
  extra.innerHTML = `
    <div class="key">
      <div class="key-head"><label for="persona">Personality</label></div>
      <div class="field">
        <select id="persona">
          ${PERSONA_IDS.map((id) => `<option value="${id}">${PERSONAS[id].name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="key">
      <div class="key-head">
        <label for="handsfree">Hands-free ("Jarvis, …")</label>
        <input id="handsfree" type="checkbox" class="toggle" />
      </div>
      <p class="hint">
        Start with the name: "Jarvis, what's the weather?" or "OK Jarvis". Don't say "Hey Jarvis":
        "Hey E…" wakes the glasses' own Even AI assistant instead.
        Keeps the glasses mic on while Jarvis is open and listens for the name, so it uses more battery.
        Each phrase you say is sent to Groq to check for the name (speech the app tags as someone else is skipped),
        which counts against Groq's free daily quota. Works only while the app is open on the glasses.
      </p>
    </div>
    <div class="key">
      <div class="key-head">
        <label for="proactive">Heads-ups</label>
        <input id="proactive" type="checkbox" class="toggle" />
      </div>
      <p class="hint">
        Jarvis speaks first: rain on the way, when to leave for an event with a location, and who you're meeting.
        Checks the weather every 10 minutes while the app is open.
      </p>
    </div>`
  root.append(extra)
  const select = extra.querySelector<HTMLSelectElement>('#persona')!
  select.value = (await settings.persona()) || 'jarvis'
  select.addEventListener('change', async () => {
    await settings.setPersona(select.value)
    onChange()
  })
  const toggle = extra.querySelector<HTMLInputElement>('#handsfree')!
  toggle.checked = await settings.handsFree()
  toggle.addEventListener('change', async () => {
    await settings.setHandsFree(toggle.checked)
    onChange()
  })

  const proactive = extra.querySelector<HTMLInputElement>('#proactive')!
  proactive.checked = await settings.proactive()
  proactive.addEventListener('change', () => void settings.setProactive(proactive.checked))

  for (const p of prefs) {
    const row = document.createElement('div')
    row.className = 'key'
    row.innerHTML = `
      <div class="key-head">
        <label for="${p.id}">${p.label}</label>
        <span class="badge"></span>
      </div>
      <div class="field">
        <input id="${p.id}" type="${p.type}" placeholder="${p.placeholder}" />
      </div>
      <div class="actions"><button type="button" class="primary save" disabled>Save</button></div>
      <p class="msg" role="status"></p>`
    root.append(row)

    const input = row.querySelector('input')!
    const badge = row.querySelector('.badge')!
    const save = row.querySelector<HTMLButtonElement>('.save')!
    const msg = row.querySelector('.msg')!
    const show = (v: string) => {
      badge.textContent = v ? v.toUpperCase() : p.empty
      badge.className = `badge ${v ? 'ok' : 'warn'}`
    }
    let current = await p.get()
    input.value = current
    show(current)

    input.addEventListener('input', () => {
      save.disabled = input.value.trim() === current
      msg.textContent = ''
    })
    save.addEventListener('click', async () => {
      current = input.value.trim()
      await p.set(current)
      show(current)
      save.disabled = true
      msg.textContent = 'Saved.'
      msg.className = 'msg ok'
      onChange()
    })
  }
}
