import { APPS_SCRIPT, looksLikeScriptUrl, type GoogleCalendar } from '../data/gcal'
import type { Settings } from '../settings'

/** Links Google Calendar through a small Apps Script the user deploys in their own account. */
export async function mountCalendar(root: HTMLElement, settings: Settings, calendar: GoogleCalendar) {
  root.innerHTML = `
    <details>
      <summary>How to link it (about 3 minutes)</summary>
      <ol class="steps">
        <li>On a computer, open <code>script.google.com</code> and create a new project.</li>
        <li>Replace the code with the script below and save.</li>
        <li>Deploy → New deployment → type <b>Web app</b>. Execute as <b>Me</b>, access <b>Anyone</b>. Approve the calendar permission.</li>
        <li>Copy the web app URL (ends in <code>/exec</code>) and paste it here.</li>
      </ol>
      <p class="hint">Anyone with that URL can read your calendar and add events, so keep it private.</p>
      <p class="hint">Linked before version 0.6? Paste the new script and choose Deploy → Manage deployments → Edit → New version, so Jarvis gets event locations and guests for leave-now alerts and meeting briefs.</p>
      <textarea class="code" rows="8" readonly aria-label="Apps Script code">${APPS_SCRIPT.replace(/</g, '&lt;')}</textarea>
      <div class="actions"><button type="button" class="copy">Copy script</button></div>
    </details>
    <div class="key">
      <div class="key-head"><label for="gcal-url">Web app URL</label><span class="badge"></span></div>
      <div class="field"><input id="gcal-url" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" /></div>
      <div class="actions">
        <button type="button" class="primary save" disabled>Save and sync</button>
        <button type="button" class="sync">Sync now</button>
        <button type="button" class="clear">Unlink</button>
      </div>
      <p class="msg" role="status"></p>
    </div>`

  const input = root.querySelector<HTMLInputElement>('#gcal-url')!
  const badge = root.querySelector('.badge')!
  const save = root.querySelector<HTMLButtonElement>('.save')!
  const msg = root.querySelector('.msg')!
  const say = (text: string, kind: '' | 'ok' | 'warn' = '') => {
    msg.textContent = text
    msg.className = `msg ${kind}`
  }
  const show = (url: string) => {
    badge.textContent = url ? 'LINKED' : 'NOT LINKED'
    badge.className = `badge ${url ? 'ok' : 'warn'}`
  }
  let current = await settings.calendarUrl()
  input.value = current
  show(current)

  const sync = async () => {
    say('Syncing…')
    try {
      const n = await calendar.sync(true)
      say(n < 0 ? 'Not linked.' : `Synced ${n} event${n === 1 ? '' : 's'} (yesterday to 2 weeks ahead).`, n < 0 ? 'warn' : 'ok')
    } catch (err) {
      say(`Sync failed: ${err instanceof Error ? err.message : err}. Check the deployment allows "Anyone".`, 'warn')
    }
  }

  input.addEventListener('input', () => {
    const v = input.value.trim()
    save.disabled = v === current
    say(v && !looksLikeScriptUrl(v) ? 'That should be a script.google.com/macros/s/…/exec URL.' : '', 'warn')
  })
  save.addEventListener('click', async () => {
    current = input.value.trim()
    await settings.setCalendarUrl(current)
    show(current)
    save.disabled = true
    await sync()
  })
  root.querySelector('.sync')!.addEventListener('click', () => void sync())
  root.querySelector('.clear')!.addEventListener('click', async () => {
    current = ''
    input.value = ''
    await settings.setCalendarUrl('')
    await calendar.sync(true).catch(() => {})
    show('')
    say('Unlinked. Google events removed from Jarvis.')
  })
  root.querySelector('.copy')!.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT)
      b.textContent = 'Copied'
    } catch {
      root.querySelector('textarea')!.select()
      b.textContent = 'Select and copy'
    }
  })
}
