import type { Settings } from '../settings'

/** Home city: used for the dashboard weather and "what's the weather" with no place named. */
export async function mountPrefs(root: HTMLElement, settings: Settings, onChange: () => void) {
  root.innerHTML = `
    <div class="key">
      <div class="key-head">
        <label for="home-city">Home city</label>
        <span class="badge"></span>
      </div>
      <div class="field">
        <input id="home-city" type="text" autocomplete="address-level2" placeholder="e.g. London" />
      </div>
      <div class="actions"><button type="button" class="primary save" disabled>Save</button></div>
      <p class="msg" role="status"></p>
    </div>`

  const input = root.querySelector('input')!
  const badge = root.querySelector('.badge')!
  const save = root.querySelector<HTMLButtonElement>('.save')!
  const msg = root.querySelector('.msg')!

  const show = (city: string) => {
    badge.textContent = city ? city.toUpperCase() : 'NOT SET'
    badge.className = `badge ${city ? 'ok' : 'warn'}`
  }
  const current = await settings.homeCity()
  input.value = current
  show(current)

  input.addEventListener('input', () => {
    save.disabled = input.value.trim() === current
    msg.textContent = ''
  })
  save.addEventListener('click', async () => {
    const city = input.value.trim()
    await settings.setHomeCity(city)
    show(city)
    save.disabled = true
    msg.textContent = 'Saved.'
    msg.className = 'msg ok'
    onChange()
  })
}
