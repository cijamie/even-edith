import type { Settings } from '../settings'
import { allowedHook, parseHooks } from '../tools/home'

/** Named webhooks for "Jarvis, lights off": Home Assistant Cloud or IFTTT. */
export async function mountSmartHome(root: HTMLElement, settings: Settings) {
  root.innerHTML = `
    <details>
      <summary>How to set it up</summary>
      <ol class="steps">
        <li><b>Home Assistant</b>: make an automation with a <b>Webhook</b> trigger, then in Settings → Home Assistant Cloud → Webhooks, copy its <code>hooks.nabu.casa</code> URL.
          The spoken command arrives as <code>{{ trigger.data.command }}</code>, so one automation can handle "lights on" and "lights off".</li>
        <li><b>IFTTT</b>: a Webhooks applet; its <code>maker.ifttt.com/trigger/…</code> URL gets the command as <code>value1</code>.</li>
        <li>Add one line per device or scene: <code>Lights | https://hooks.nabu.casa/…</code></li>
      </ol>
      <p class="hint">Anyone with a webhook URL can trigger it, so keep them private. Only those two services are allowed, as the Even app limits which sites Jarvis can reach.</p>
    </details>
    <textarea rows="4" spellcheck="false" autocapitalize="off" placeholder="Lights | https://hooks.nabu.casa/…" aria-label="Smart home webhooks"></textarea>
    <div class="actions"><button type="button" class="primary save" disabled>Save</button></div>
    <p class="msg" role="status"></p>`
  const area = root.querySelector('textarea')!
  const save = root.querySelector<HTMLButtonElement>('.save')!
  const msg = root.querySelector('.msg')!
  let saved = await settings.smartHome()
  area.value = saved
  area.addEventListener('input', () => {
    save.disabled = area.value === saved
    msg.textContent = ''
  })
  save.addEventListener('click', async () => {
    const hooks = parseHooks(area.value)
    const bad = hooks.filter((h) => !allowedHook(h.url))
    saved = area.value
    await settings.setSmartHome(saved)
    save.disabled = true
    msg.textContent = bad.length
      ? `Saved, but ${bad.map((h) => h.name).join(', ')} won't work: only hooks.nabu.casa and maker.ifttt.com URLs are allowed.`
      : `Saved ${hooks.length} webhook${hooks.length === 1 ? '' : 's'}. Try "Jarvis, ${hooks[0]?.name.toLowerCase() ?? 'lights'} off".`
    msg.className = `msg ${bad.length ? 'warn' : 'ok'}`
  })
}
