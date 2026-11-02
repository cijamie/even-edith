import type { Store } from '../store'
import { VERSION } from '../version'
import { saveFile } from './expenses-ui'

// Everything EDITH stores, except caches and usage counters.
const DATA_KEYS = [
  'edith.homeCity', 'edith.briefingTime', 'edith.teleprompter', 'edith.guide', 'edith.persona', 'edith.handsFree',
  'edith.calendarUrl', 'edith.proactive', 'edith.smartHome', 'edith.agenda', 'edith.memory', 'edith.lists',
  'edith.pins', 'edith.expenses', 'edith.decks',
]
const KEY_KEYS = ['edith.geminiKey', 'edith.groqKey']

/** Export everything to a file (to move phones or reinstall) and restore from one. */
export function mountBackup(root: HTMLElement, store: Store) {
  root.innerHTML = `
    <div class="key">
      <div class="key-head"><label for="backup-keys">Include API keys</label><input id="backup-keys" type="checkbox" class="toggle" /></div>
      <p class="hint">Off by default. With keys included, treat the file like a password.</p>
    </div>
    <div class="actions">
      <button type="button" class="primary export">Export backup</button>
      <label class="button">Restore from file<input type="file" accept="application/json,.json" hidden /></label>
    </div>
    <p class="msg" role="status"></p>`
  const msg = root.querySelector('.msg')!
  const say = (text: string, kind: 'ok' | 'warn') => {
    msg.textContent = text
    msg.className = `msg ${kind}`
  }

  root.querySelector('.export')!.addEventListener('click', async () => {
    const keys = [...DATA_KEYS, ...(root.querySelector<HTMLInputElement>('#backup-keys')!.checked ? KEY_KEYS : [])]
    const data: Record<string, string> = {}
    for (const k of keys) {
      const v = await store.get(k)
      if (v) data[k] = v
    }
    const backup = { app: 'even-edith', version: VERSION, exported: new Date().toISOString(), data }
    await saveFile(`edith-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 1), 'application/json')
    say(`Exported ${Object.keys(data).length} items.`, 'ok')
  })

  root.querySelector<HTMLInputElement>('input[type=file]')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const backup = JSON.parse(await file.text())
      if (backup?.app !== 'even-edith' || typeof backup.data !== 'object') throw new Error('not an EDITH backup')
      const entries = Object.entries(backup.data as Record<string, unknown>).filter(
        ([k, v]) => [...DATA_KEYS, ...KEY_KEYS].includes(k) && typeof v === 'string',
      ) as [string, string][]
      if (!confirm(`Restore ${entries.length} items from ${backup.exported?.slice(0, 10) ?? 'this backup'}? This replaces what's on this phone.`)) return
      for (const [k, v] of entries) await store.set(k, v)
      say('Restored. Reloading…', 'ok')
      setTimeout(() => location.reload(), 800)
    } catch (err) {
      say(`That file didn't work: ${err instanceof Error ? err.message : err}.`, 'warn')
    }
  })
}
