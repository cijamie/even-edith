import { parseCards, type Decks } from '../data/decks'

/** Decks with counts, practise on the glasses, and a box to paste new cards. */
export function mountFlashcards(root: HTMLElement, decks: Decks, practise: (deck: string) => void) {
  root.innerHTML = `
    <div class="deck-list"></div>
    <div class="field"><input class="deck-name" type="text" placeholder="Deck name, e.g. Spanish" aria-label="Deck name" /></div>
    <textarea rows="5" placeholder="One card per line: question | answer" aria-label="Cards to add"></textarea>
    <div class="actions"><button type="button" class="primary add" disabled>Add cards</button></div>
    <p class="msg" role="status"></p>`
  const list = root.querySelector<HTMLElement>('.deck-list')!
  const name = root.querySelector<HTMLInputElement>('.deck-name')!
  const area = root.querySelector('textarea')!
  const add = root.querySelector<HTMLButtonElement>('.add')!
  const msg = root.querySelector('.msg')!

  const render = () => {
    const all = decks.all
    list.innerHTML = all.length
      ? `<ul class="facts">${all
          .map(
            (d) => `<li><span>${escape(d.name)} <small>· ${d.cards.length} cards, ${decks.due(d).length} due</small></span>
              <span class="row-actions"><button type="button" data-go="${escape(d.name)}">Practise</button>
              <button type="button" data-del="${d.id}">Delete</button></span></li>`,
          )
          .join('')}</ul>`
      : '<p class="hint">No decks yet. Paste cards below, or say "Jarvis, make flashcards on capital cities".</p>'
    list.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => practise(b.dataset.go!)))
    list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
      b.addEventListener('click', () => confirm('Delete this deck?') && void decks.removeDeck(b.dataset.del!)),
    )
  }

  const update = () => (add.disabled = !name.value.trim() || !parseCards(area.value).length)
  name.addEventListener('input', update)
  area.addEventListener('input', () => {
    update()
    msg.textContent = ''
  })
  add.addEventListener('click', async () => {
    const r = await decks.add(name.value.trim(), parseCards(area.value))
    area.value = ''
    update()
    msg.textContent = `Added ${r.added} to ${r.deck} (${r.total} cards).`
    msg.className = 'msg ok'
  })
  decks.onChange(render)
  render()
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
