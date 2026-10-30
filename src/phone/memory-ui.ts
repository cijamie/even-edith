import type { Memory } from '../data/memory'

/** What EDITH has been asked to remember, with a way to forget each item. */
export function mountMemory(root: HTMLElement, memory: Memory) {
  const render = () => {
    const facts = memory.all
    root.innerHTML = facts.length
      ? `<ul class="facts">${facts
          .map((f) => `<li><span>${escape(f.text)}</span><button type="button" data-id="${f.id}" aria-label="Forget">Forget</button></li>`)
          .join('')}</ul>`
      : '<p class="hint">Nothing yet. Say "EDITH, remember that…".</p>'
    root.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) =>
      b.addEventListener('click', async () => {
        await memory.remove(b.dataset.id!)
        render()
      }),
    )
  }
  render()
  // Facts are added by voice, so refresh whenever the card scrolls into view.
  new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && render()).observe(root)
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
