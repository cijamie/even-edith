import type { Settings } from '../settings'

/** Paste a script here; "EDITH, open teleprompter" (or the button) shows it on the glasses. */
export async function mountTeleprompter(root: HTMLElement, settings: Settings, show: (follow: boolean) => void) {
  root.innerHTML = `
    <textarea rows="6" placeholder="Paste a speech, notes or a list" aria-label="Teleprompter script"></textarea>
    <div class="actions">
      <button type="button" class="primary save" disabled>Save</button>
      <button type="button" class="show">Show on glasses</button>
      <button type="button" class="show follow">Follow my voice</button>
    </div>
    <p class="hint">Follow my voice turns the pages as you read aloud (uses Groq, like captions).</p>
    <p class="msg" role="status"></p>`

  const area = root.querySelector('textarea')!
  const save = root.querySelector<HTMLButtonElement>('.save')!
  const msg = root.querySelector('.msg')!
  let saved = await settings.teleprompter()
  area.value = saved

  area.addEventListener('input', () => {
    save.disabled = area.value === saved
    msg.textContent = ''
  })
  save.addEventListener('click', async () => {
    saved = area.value
    await settings.setTeleprompter(saved)
    save.disabled = true
    msg.textContent = 'Saved.'
    msg.className = 'msg ok'
  })
  root.querySelectorAll<HTMLButtonElement>('.show').forEach((b) =>
    b.addEventListener('click', async () => {
      if (area.value !== saved) save.click()
      await settings.setTeleprompter(area.value)
      show(b.classList.contains('follow'))
    }),
  )
}
