import type { Settings } from '../settings'

type Pref = {
  id: string
  label: string
  type: string
  placeholder: string
  empty: string
  get: () => Promise<string>
  set: (v: string) => Promise<void>
}

/** Home city (weather, map fallback) and the daily briefing time. */
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
