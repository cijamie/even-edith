import type { Lists } from '../data/lists'

/** Checklists, editable on the phone and in step with ticks made on the glasses. */
export function mountLists(root: HTMLElement, lists: Lists, show: (name: string) => void) {
  const render = () => {
    const all = lists.all
    root.innerHTML =
      (all.length
        ? all
            .map(
              (l) => `
          <div class="list" data-list="${l.id}">
            <div class="key-head">
              <strong>${escape(l.name)}</strong>
              <span class="badge">${l.items.filter((i) => !i.done).length} LEFT</span>
            </div>
            <ul class="checks-list">${l.items
              .map(
                (i) => `<li><label><input type="checkbox" data-item="${i.id}" ${i.done ? 'checked' : ''} /> <span>${escape(i.text)}</span></label>
                  <button type="button" data-remove="${i.id}" aria-label="Remove ${escape(i.text)}">×</button></li>`,
              )
              .join('')}</ul>
            <form class="field add"><input type="text" placeholder="Add item" aria-label="Add to ${escape(l.name)}" /><button type="submit">Add</button></form>
            <div class="actions">
              <button type="button" data-show>Show on glasses</button>
              <button type="button" data-clear>Clear ticked</button>
            </div>
          </div>`,
            )
            .join('')
        : '<p class="hint">No lists yet. Say "Jarvis, add milk and eggs to my shopping list", or start one here.</p>') +
      `<form class="field new"><input type="text" placeholder="New list name" aria-label="New list name" /><button type="submit">Create</button></form>`

    root.querySelectorAll<HTMLElement>('[data-list]').forEach((el) => {
      const id = el.dataset.list!
      const name = lists.all.find((l) => l.id === id)?.name ?? ''
      el.querySelectorAll<HTMLInputElement>('[data-item]').forEach((box) =>
        box.addEventListener('change', () => void lists.setDone(id, box.dataset.item!, box.checked)),
      )
      el.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
        b.addEventListener('click', () => void lists.removeItem(id, b.dataset.remove!)),
      )
      el.querySelector<HTMLFormElement>('form.add')!.addEventListener('submit', (e) => {
        e.preventDefault()
        const input = (e.currentTarget as HTMLFormElement).querySelector('input')!
        if (input.value.trim()) void lists.add(name, [input.value.trim()])
      })
      el.querySelector('[data-show]')!.addEventListener('click', () => show(name))
      el.querySelector('[data-clear]')!.addEventListener('click', () => void lists.clear(id, true))
    })
    root.querySelector<HTMLFormElement>('form.new')!.addEventListener('submit', (e) => {
      e.preventDefault()
      const input = (e.currentTarget as HTMLFormElement).querySelector('input')!
      const name = input.value.trim()
      if (name) void lists.add(name, [])
    })
  }
  lists.onChange(render)
  render()
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
