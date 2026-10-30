import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Display, Snapshot } from '../hud/display'
import { LAYOUTS } from '../hud/layout'
import type { Action } from '../tools'

/** What the phone remote can do to the glasses. */
export type Remote = {
  event(e: EvenHubEvent): void
  say(text: string): void
  action(a: Action): void
  replayBoot(): void
}

// Text brightness 0-4 → opacity of the HUD green.
const LEVEL_OPACITY = [0.25, 0.42, 0.62, 0.82, 1]

const sys = (eventType?: OsEventTypeList) => ({ sysEvent: { eventType } }) as unknown as EvenHubEvent

const CHIPS: [string, Action | 'boot'][] = [
  ['Dashboard', { type: 'dashboard' }],
  ['Map', { type: 'map' }],
  ['Radar: cafés', { type: 'radar', category: 'cafe' }],
  ['Captions', { type: 'captions', translate: false }],
  ['Translate', { type: 'captions', translate: true }],
  ['Teleprompter', { type: 'teleprompter' }],
  ['Briefing', { type: 'briefing' }],
  ['Meeting', { type: 'meeting' }],
  ['Focus', { type: 'protocol', name: 'focus' }],
  ['Night', { type: 'protocol', name: 'night' }],
  ['Stealth', { type: 'protocol', name: 'stealth' }],
  ['Standard', { type: 'protocol', name: 'standard' }],
  ['Replay boot', 'boot'],
]

/** Live copy of the HUD plus controls, for demos and handing the glasses to someone else. */
export function mountMirror(root: HTMLElement, display: Display, remote: Remote) {
  root.innerHTML = `
    <div class="mirror" aria-label="Live view of the glasses display">
      <div class="screen"></div>
    </div>
    <div class="remote">
      <button type="button" class="primary talk">Hold to talk</button>
      <div class="pad">
        <button type="button" data-ev="up" aria-label="Swipe up">Swipe ▲</button>
        <button type="button" data-ev="press">Press</button>
        <button type="button" data-ev="down" aria-label="Swipe down">Swipe ▼</button>
      </div>
      <form class="field ask">
        <input type="text" placeholder="Type to EDITH" aria-label="Type a request to EDITH" />
        <button type="submit">Send</button>
      </form>
      <div class="chips">${CHIPS.map(([label], i) => `<button type="button" class="chip" data-chip="${i}">${label}</button>`).join('')}</div>
      <button type="button" class="exit">Exit app on glasses</button>
    </div>`

  const mirror = root.querySelector<HTMLElement>('.mirror')!
  const screen = root.querySelector<HTMLElement>('.screen')!

  // Scale the 576x288 screen to the card width.
  const fit = () => (screen.style.transform = `scale(${mirror.clientWidth / 576})`)
  new ResizeObserver(fit).observe(mirror)

  const urls = new Map<number, { png: Uint8Array; url: string }>()
  let pending: Snapshot | null = null
  // At most one redraw per 50 ms, however fast the HUD changes. (A timer rather
  // than requestAnimationFrame, which pauses in some WebViews and panes.)
  display.onChange((s) => {
    if (!pending)
      setTimeout(() => {
        const latest = pending
        pending = null
        if (latest) draw(latest)
      }, 50)
    pending = s
  })

  function draw(s: Snapshot) {
    const cells: string[] = []
    for (const spec of LAYOUTS[s.layout]) {
      const style = `left:${spec.x}px;top:${spec.y}px;width:${spec.w}px;height:${spec.h}px`
      if (spec.kind === 'image') {
        const png = s.images.get(spec.id)
        if (!png) continue
        let entry = urls.get(spec.id)
        if (entry?.png !== png) {
          if (entry) URL.revokeObjectURL(entry.url)
          entry = { png, url: URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })) }
          urls.set(spec.id, entry)
        }
        cells.push(`<img class="cell" style="${style}" src="${entry.url}" alt="" />`)
      } else {
        const text = s.visible(spec, s.text.get(spec.id) ?? '')
        const pad = spec.padding ?? 0
        cells.push(
          `<div class="cell text" style="${style};padding:${pad}px;opacity:${LEVEL_OPACITY[s.color(spec)]}">${escape(text)}</div>`,
        )
      }
    }
    screen.innerHTML = cells.join('')
  }

  // Hold to talk: pointer down/up become long press/release, like the ring.
  const talk = root.querySelector<HTMLButtonElement>('.talk')!
  let holding = false
  talk.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    holding = true
    talk.setPointerCapture(e.pointerId)
    talk.textContent = 'Listening… release to send'
    remote.event(sys(OsEventTypeList.LONG_PRESS_EVENT))
  })
  const release = () => {
    if (!holding) return
    holding = false
    talk.textContent = 'Hold to talk'
    remote.event(sys(OsEventTypeList.LONG_PRESS_RELEASE_EVENT))
  }
  talk.addEventListener('pointerup', release)
  talk.addEventListener('pointercancel', release)
  talk.addEventListener('contextmenu', (e) => e.preventDefault())

  root.querySelectorAll<HTMLButtonElement>('[data-ev]').forEach((b) =>
    b.addEventListener('click', () => {
      const ev = b.dataset.ev
      remote.event(
        ev === 'up'
          ? sys(OsEventTypeList.SCROLL_TOP_EVENT)
          : ev === 'down'
            ? sys(OsEventTypeList.SCROLL_BOTTOM_EVENT)
            : sys(undefined), // press: CLICK_EVENT arrives without a type
      )
    }),
  )

  const form = root.querySelector<HTMLFormElement>('.ask')!
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const input = form.querySelector('input')!
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    remote.say(text)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = CHIPS[Number(b.dataset.chip)][1]
      if (target === 'boot') remote.replayBoot()
      else remote.action(target)
    }),
  )

  root.querySelector('.exit')!.addEventListener('click', () => {
    if (confirm('Close EDITH on the glasses?')) remote.event(sys(OsEventTypeList.DOUBLE_CLICK_EVENT))
  })
}

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
