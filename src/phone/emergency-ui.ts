import type { Locator } from '../geo/location'
import { emergencyNumber, mapLink } from '../modes/emergency'

/** "Share my location" for emergencies, plus a shortcut to emergency protocol on the glasses. */
export function mountEmergency(root: HTMLElement, locator: Locator, protocol: () => void) {
  root.innerHTML = `
    <p class="hint">Emergency number here: <b>${emergencyNumber()}</b>. EDITH can't call for you.</p>
    <div class="actions">
      <button type="button" class="primary share">Share my location</button>
      <button type="button" class="protocol">Emergency protocol on glasses</button>
    </div>
    <p class="msg" role="status"></p>`
  const msg = root.querySelector('.msg')!
  const share = root.querySelector<HTMLButtonElement>('.share')!
  share.addEventListener('click', async () => {
    share.disabled = true
    msg.textContent = 'Locating…'
    msg.className = 'msg'
    const fix = await locator.get(0)
    share.disabled = false
    if (!fix || fix.source === 'home') {
      msg.textContent = 'No location. Allow location for the Even app.'
      msg.className = 'msg warn'
      return
    }
    const text = `I need help. I'm here: ${mapLink(fix.lat, fix.lon)}${fix.accuracy ? ` (±${Math.round(fix.accuracy)}m)` : ''}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My location', text })
        msg.textContent = ''
        return
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return (msg.textContent = '')
    }
    try {
      await navigator.clipboard.writeText(text)
      msg.textContent = 'Copied a message with your location. Paste it to someone.'
      msg.className = 'msg ok'
    } catch {
      msg.textContent = text
    }
  })
  root.querySelector('.protocol')!.addEventListener('click', protocol)
}
