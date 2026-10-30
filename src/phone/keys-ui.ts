import { looksValid, maskKey, type KeyName, type Settings } from '../settings'

const FIELDS: { name: KeyName; label: string; where: string; format: string }[] = [
  {
    name: 'groq',
    label: 'Groq (speech to text)',
    where: 'console.groq.com/keys',
    format: 'Groq keys start with gsk_',
  },
  {
    name: 'gemini',
    label: 'Gemini (the brain)',
    where: 'aistudio.google.com/apikey',
    format: 'Gemini keys start with AIza or AQ.',
  },
]

/** Renders the paste-your-key form. `onChange` fires after a key is saved or cleared. */
export async function mountKeys(root: HTMLElement, settings: Settings, onChange: () => void) {
  const saved = await settings.all()
  for (const f of FIELDS) {
    const row = document.createElement('div')
    row.className = 'key'
    row.innerHTML = `
      <div class="key-head">
        <label for="key-${f.name}">${f.label}</label>
        <span class="badge"></span>
      </div>
      <div class="field">
        <input id="key-${f.name}" type="password" autocomplete="off" autocapitalize="off"
          autocorrect="off" spellcheck="false" placeholder="Paste key" />
        <button type="button" class="reveal" aria-label="Show key">Show</button>
      </div>
      <div class="actions">
        <button type="button" class="primary save" disabled>Save</button>
        <button type="button" class="clear">Clear</button>
      </div>
      <p class="msg" role="status"></p>
      <p class="where">Get one at <code>${f.where}</code></p>`
    root.append(row)

    const input = row.querySelector('input')!
    const badge = row.querySelector('.badge')!
    const save = row.querySelector<HTMLButtonElement>('.save')!
    const clear = row.querySelector<HTMLButtonElement>('.clear')!
    const reveal = row.querySelector<HTMLButtonElement>('.reveal')!
    const msg = row.querySelector('.msg')!

    const showSaved = (value: string) => {
      badge.textContent = value ? `SAVED ${maskKey(value)}` : 'NOT SET'
      badge.className = `badge ${value ? 'ok' : 'warn'}`
      clear.disabled = !value
    }
    const say = (text: string, kind: '' | 'ok' | 'warn' = '') => {
      msg.textContent = text
      msg.className = `msg ${kind}`
    }
    showSaved(saved[f.name])

    input.addEventListener('input', () => {
      const v = input.value.trim()
      save.disabled = !v
      say(v && !looksValid(f.name, v) ? `That doesn't look right. ${f.format}.` : '', 'warn')
    })

    reveal.addEventListener('click', () => {
      const hidden = input.type === 'password'
      input.type = hidden ? 'text' : 'password'
      reveal.textContent = hidden ? 'Hide' : 'Show'
      reveal.setAttribute('aria-label', hidden ? 'Hide key' : 'Show key')
    })

    save.addEventListener('click', async () => {
      const v = input.value.trim()
      if (!v) return
      await settings.set(f.name, v)
      input.value = ''
      save.disabled = true
      showSaved(v)
      say('Saved.', 'ok')
      onChange()
    })

    clear.addEventListener('click', async () => {
      await settings.set(f.name, '')
      showSaved('')
      say('Cleared.')
      onChange()
    })
  }
}
