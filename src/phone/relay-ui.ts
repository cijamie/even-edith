import { randomTopic, topicUrl } from '../net/relay'
import type { Settings } from '../settings'

/**
 * Notification relay (ntfy.sh) and the proactive-alerts switch. The relay URL
 * is what phone automations post to; anything sent there appears on the glasses.
 */
export async function mountRelay(root: HTMLElement, settings: Settings) {
  root.innerHTML = `
    <div class="key">
      <div class="key-head"><label>Notification relay</label><span class="badge"></span></div>
      <p class="where">Post to: <code class="url"></code></p>
      <div class="actions">
        <button type="button" class="primary on">Turn on</button>
        <button type="button" class="copy">Copy URL</button>
        <button type="button" class="test">Send test</button>
        <button type="button" class="off">Turn off</button>
      </div>
      <p class="msg" role="status"></p>
    </div>
    <div class="key">
      <div class="key-head"><label for="proactive">Proactive alerts</label><span class="badge pro"></span></div>
      <p class="hint">Rain about to start, place reminders, and your shopping list when you pass a supermarket.</p>
      <label class="tick"><input id="proactive" type="checkbox" /> <span>Enabled</span></label>
    </div>`

  const badge = root.querySelector('.badge')!
  const url = root.querySelector('.url')!
  const msg = root.querySelector('.msg')!
  const buttons = (sel: string) => root.querySelector<HTMLButtonElement>(sel)!

  const show = async () => {
    const topic = await settings.relayTopic()
    badge.textContent = topic ? 'ON' : 'OFF'
    badge.className = `badge ${topic ? 'ok' : 'warn'}`
    url.textContent = topic ? topicUrl(topic) : '(turn on to get a private URL)'
    buttons('.on').hidden = !!topic
    for (const s of ['.copy', '.test', '.off']) buttons(s).hidden = !topic
  }
  const say = (text: string, ok = true) => {
    msg.textContent = text
    msg.className = `msg ${ok ? 'ok' : 'warn'}`
  }

  buttons('.on').addEventListener('click', async () => {
    await settings.setRelayTopic(randomTopic())
    await show()
    say('On. Point a phone automation at this URL; keep it private.')
  })
  buttons('.off').addEventListener('click', async () => {
    await settings.setRelayTopic('')
    await show()
    say('Relay off.')
  })
  buttons('.copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url.textContent ?? '')
      say('Copied.')
    } catch {
      say('Copy failed; select the URL and copy it by hand.', false)
    }
  })
  buttons('.test').addEventListener('click', async () => {
    try {
      // Title as a query parameter, not a header, so there's no CORS preflight.
      const res = await fetch(`${url.textContent}?title=EDITH`, { method: 'POST', body: 'Relay test. Systems nominal.' })
      say(res.ok ? 'Sent. It should appear on the glasses within 20 seconds.' : `ntfy said HTTP ${res.status}.`, res.ok)
    } catch {
      say('Could not reach ntfy.sh from here.', false)
    }
  })

  const toggle = root.querySelector<HTMLInputElement>('#proactive')!
  const pro = root.querySelector('.pro')!
  const showPro = (on: boolean) => {
    toggle.checked = on
    pro.textContent = on ? 'ON' : 'OFF'
    pro.className = `badge pro ${on ? 'ok' : 'warn'}`
  }
  showPro(await settings.proactive())
  toggle.addEventListener('change', async () => {
    await settings.setProactive(toggle.checked)
    showPro(toggle.checked)
  })

  await show()
}
