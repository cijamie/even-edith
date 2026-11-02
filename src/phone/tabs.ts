export type Tab = 'glasses' | 'organiser' | 'studio' | 'settings' | 'sos'

const KEY = 'edith.phoneTab'

/**
 * Bottom tab bar for the phone page: each [data-tab] button shows the matching
 * [data-panel]. The last tab is remembered on this device (SOS never is).
 */
export function mountTabs(): (tab: Tab) => void {
  const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')]
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')]

  const show = (tab: Tab) => {
    for (const p of panels) p.hidden = p.dataset.panel !== tab
    for (const b of buttons) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false')
    window.scrollTo(0, 0)
    if (tab !== 'sos') safe(() => localStorage.setItem(KEY, tab))
  }

  for (const b of buttons) b.addEventListener('click', () => show(b.dataset.tab as Tab))
  const saved = safe(() => localStorage.getItem(KEY)) as Tab | null
  show(saved && panels.some((p) => p.dataset.panel === saved) ? saved : 'glasses')
  return show
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
