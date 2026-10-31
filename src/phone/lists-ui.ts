import type { Agenda } from '../data/agenda'

/** Shopping, to-do and other lists: tick, add and clear from the phone. */
export function mountLists(root: HTMLElement, agenda: Agenda) {
  let selected = 'shopping'

  const render = () => {
    const lists = agenda.lists
    if (!lists.some((l) => l.name === selected) && lists.length) selected = lists[0].name
    const list = agenda.list(selected)
    const tabs = lists.map((l) => `<button type="button" class="chip${l.name === selected ? ' on' : ''}" data-list="${escape(l.name)}">${escape(l.name)}</button>`).join('')
    const items = list?.items ?? []
    root.innerHTML = `
      ${lists.length ? `<div class="chips">${tabs}</div>` : ''}
      ${
        items.length
          ? `<ul class="facts">${items
              .map(
                (i) => `<li class="${i.done ? 'done' : ''}">
                  <label class="tick"><input type="checkbox" data-tick="${i.id}" ${i.done ? 'checked' : ''} /> <span>${escape(i.text)}</span></label>
                  <button type="button" data-del="${i.id}" aria-label="Remove">Remove</button>
                </li>`,
              )
              .join('')}</ul>`
          : `<p class="hint">${lists.length ? 'This list is empty.' : 'No lists yet. Say "EDITH, add milk to my shopping list".'}</p>`
      }
      <form class="field add">
        <input type="text" placeholder="Add to ${escape(selected)} (commas for several)" aria-label="New item" />
        <button type="submit">Add</button>
      </form>
      <div class="actions">
        <input class="new-list" type="text" placeholder="New list name" aria-label="New list name" />
        ${items.some((i) => i.done) ? '<button type="button" class="clear">Clear ticked</button>' : ''}
      </div>`

    root.querySelectorAll<HTMLButtonElement>('[data-list]').forEach((b) =>
      b.addEventListener('click', () => {
        selected = b.dataset.list!
        render()
      }),
    )
    root.querySelectorAll<HTMLInputElement>('[data-tick]').forEach((c) =>
      c.addEventListener('change', () => void agenda.markItems(selected, [c.dataset.tick!], c.checked)),
    )
    root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', () => void agenda.removeItems(selected, [b.dataset.del!])),
    )
    root.querySelector<HTMLFormElement>('.add')!.addEventListener('submit', (e) => {
      e.preventDefault()
      const input = (e.currentTarget as HTMLFormElement).querySelector('input')!
      const items = input.value.split(',').map((x) => x.trim()).filter(Boolean)
      if (items.length) void agenda.addToList(selected, items)
    })
    root.querySelector<HTMLInputElement>('.new-list')!.addEventListener('change', (e) => {
      const name = (e.currentTarget as HTMLInputElement).value.trim()
      if (!name) return
      selected = name.toLowerCase()
      render()
    })
    root.querySelector('.clear')?.addEventListener('click', () => void agenda.clearList(selected, true))
  }

  render()
  // Lists change by voice too; redraw on every save.
  agenda.onChange(render)
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
