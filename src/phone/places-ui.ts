import type { Pins } from '../data/pins'
import { mapLink } from '../modes/emergency'

/** Saved pins and location reminders, with a map link and delete for each. */
export function mountPlaces(root: HTMLElement, pins: Pins) {
  const render = () => {
    const ps = pins.pins
    const gs = pins.geofences
    const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    root.innerHTML = `
      <h3 class="sub">Location reminders</h3>
      ${
        gs.length
          ? `<ul class="facts">${gs
              .map((g) => `<li><span>${escape(g.text)} <small>· at ${escape(g.place)}</small></span><button type="button" data-geo="${g.id}">Delete</button></li>`)
              .join('')}</ul>`
          : '<p class="hint">None. Say "EDITH, remind me to buy batteries when I get to Tesco".</p>'
      }
      <h3 class="sub">Pins</h3>
      ${
        ps.length
          ? `<ul class="facts">${ps
              .map(
                (p) => `<li><span>${escape(p.label)} <small>· ${when(p.at)}${p.auto ? ' · auto' : ''}</small></span>
                  <span class="row-actions"><a class="button" href="${mapLink(p.lat, p.lon)}" target="_blank" rel="noopener">Map</a>
                  <button type="button" data-pin="${p.id}">Delete</button></span></li>`,
              )
              .join('')}</ul>`
          : '<p class="hint">None. Say "EDITH, I parked here", then later "take me back to the car".</p>'
      }`
    root.querySelectorAll<HTMLButtonElement>('[data-geo]').forEach((b) => b.addEventListener('click', () => void pins.remove('geofences', b.dataset.geo!)))
    root.querySelectorAll<HTMLButtonElement>('[data-pin]').forEach((b) => b.addEventListener('click', () => void pins.remove('pins', b.dataset.pin!)))
  }
  pins.onChange(render)
  render()
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
