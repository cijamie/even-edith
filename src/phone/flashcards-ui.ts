import type { Flashcards } from '../data/flashcards'

/** Decks with due counts; import cards by pasting "front | back" lines. */
export function mountFlashcards(root: HTMLElement, cards: Flashcards, study: (deck?: string) => void) {
  root.innerHTML = `
    <div class="decks"></div>
    <div class="field"><input class="deck" type="text" placeholder="Deck name, e.g. spanish" aria-label="Deck name" /></div>
    <textarea rows="5" placeholder="One card per line: front | back&#10;la manzana | the apple" aria-label="Cards to import"></textarea>
    <div class="actions"><button type="button" class="primary import">Add cards</button></div>
    <p class="msg" role="status"></p>`

  const decks = root.querySelector<HTMLElement>('.decks')!
  const msg = root.querySelector('.msg')!

  const render = () => {
    const list = cards.decks()
    decks.innerHTML = list.length
      ? `<ul class="facts">${list
          .map(
            (d) => `<li><span>${escape(d.name)} <small class="dim">${d.due} due · ${d.total} cards</small></span>
              <span class="row"><button type="button" data-study="${escape(d.name)}">Study</button>
              <button type="button" data-drop="${escape(d.name)}">Delete</button></span></li>`,
          )
          .join('')}</ul>`
      : '<p class="hint">No decks yet. Say "EDITH, make me 15 French travel flashcards", or paste some below.</p>'
    decks.querySelectorAll<HTMLButtonElement>('[data-study]').forEach((b) => b.addEventListener('click', () => study(b.dataset.study)))
    decks.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((b) =>
      b.addEventListener('click', () => confirm(`Delete the ${b.dataset.drop} deck?`) && void cards.removeDeck(b.dataset.drop!)),
    )
  }

  root.querySelector('.import')!.addEventListener('click', async () => {
    const deck = root.querySelector<HTMLInputElement>('.deck')!.value.trim()
    const area = root.querySelector('textarea')!
    const parsed = area.value
      .split('\n')
      .map((line) => line.split(/\s*[|\t]\s*/))
      .filter((p) => p.length >= 2 && p[0] && p[1])
      .map(([front, back]) => ({ front, back }))
    if (!deck || !parsed.length) {
      msg.textContent = 'Give a deck name and at least one "front | back" line.'
      msg.className = 'msg warn'
      return
    }
    const r = await cards.add(deck, parsed)
    area.value = ''
    msg.textContent = `Added ${r.added} to ${r.deck} (${r.total} cards).`
    msg.className = 'msg ok'
  })

  render()
  cards.onChange(render)
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
