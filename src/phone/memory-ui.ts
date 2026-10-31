import { CATEGORIES, until, type Category, type Memory } from '../data/memory'

const KEEP: [string, number][] = [
  ['Forever', 0],
  ['Until tonight', -1],
  ['1 day', 86400_000],
  ['1 week', 7 * 86400_000],
]

/** What EDITH remembers, by category, with expiry; add or forget items by hand. */
export function mountMemory(root: HTMLElement, memory: Memory) {
  const render = () => {
    const facts = memory.all.sort((a, b) => (a.category ?? 'other').localeCompare(b.category ?? 'other') || b.at - a.at)
    root.innerHTML = `
      ${
        facts.length
          ? `<ul class="facts">${facts
              .map(
                (f) => `<li><span>${escape(f.text)}<br /><small class="dim">${f.category ?? 'other'}${f.expiresAt ? ` · until ${until(f.expiresAt)}` : ''}</small></span>
                  <button type="button" data-id="${f.id}" aria-label="Forget">Forget</button></li>`,
              )
              .join('')}</ul>`
          : '<p class="hint">Nothing yet. Say "EDITH, remember that…".</p>'
      }
      <form class="add-fact">
        <div class="field"><input type="text" placeholder="Something to remember" aria-label="Fact" /></div>
        <div class="actions">
          <select class="cat" aria-label="Category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
          <select class="keep" aria-label="Keep for">${KEEP.map(([l], i) => `<option value="${i}">${l}</option>`).join('')}</select>
          <button type="submit">Remember</button>
        </div>
      </form>`
    root.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => void memory.remove(b.dataset.id!)))
    root.querySelector<HTMLFormElement>('.add-fact')!.addEventListener('submit', (e) => {
      e.preventDefault()
      const form = e.currentTarget as HTMLFormElement
      const text = form.querySelector('input')!.value.trim()
      if (!text) return
      const keep = KEEP[Number(form.querySelector<HTMLSelectElement>('.keep')!.value)][1]
      const tonight = new Date()
      tonight.setHours(23, 59, 0, 0)
      const expires = keep === 0 ? undefined : keep < 0 ? tonight.getTime() : Date.now() + keep
      void memory.add(text, form.querySelector<HTMLSelectElement>('.cat')!.value as Category, expires)
    })
  }
  render()
  memory.onChange(render)
  // Facts also expire on their own, so refresh whenever the card scrolls into view.
  new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && render()).observe(root)
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
