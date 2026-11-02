import type { Settings } from '../settings'

/** Paste a recipe or how-to, one step per line; "Jarvis, start my recipe" (or the button) walks through it. */
export async function mountGuide(root: HTMLElement, settings: Settings, show: () => void) {
  root.innerHTML = `
    <textarea rows="6" placeholder="Title on the first line, then one step per line. Times like &quot;bake 20 minutes&quot; get a timer." aria-label="Recipe or guide"></textarea>
    <div class="actions">
      <button type="button" class="primary save" disabled>Save</button>
      <button type="button" class="show">Show on glasses</button>
    </div>
    <p class="msg" role="status"></p>`

  const area = root.querySelector('textarea')!
  const save = root.querySelector<HTMLButtonElement>('.save')!
  const msg = root.querySelector('.msg')!
  let saved = await settings.guide()
  area.value = saved

  area.addEventListener('input', () => {
    save.disabled = area.value === saved
    msg.textContent = ''
  })
  save.addEventListener('click', async () => {
    saved = area.value
    await settings.setGuide(saved)
    save.disabled = true
    msg.textContent = 'Saved.'
    msg.className = 'msg ok'
  })
  root.querySelector('.show')!.addEventListener('click', async () => {
    if (area.value !== saved) save.click()
    await settings.setGuide(area.value)
    show()
  })
}
