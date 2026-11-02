import type { Agenda } from '../data/agenda'

/** Notes (including meeting summaries and activity logs) with share, copy and delete. */
export function mountNotes(root: HTMLElement, agenda: Agenda) {
  const render = () => {
    const notes = agenda.notes.slice(0, 30)
    root.innerHTML = notes.length
      ? `<ul class="facts notes">${notes
          .map(
            (n) => `<li><span>${escape(n.text).replace(/\n/g, '<br>')}</span>
              <span class="row-actions">
                <button type="button" data-share="${n.id}">Share</button>
                <button type="button" data-delete="${n.id}" aria-label="Delete note">Delete</button>
              </span></li>`,
          )
          .join('')}</ul>`
      : '<p class="hint">Nothing yet. Say "Jarvis, take a note…", or record a meeting.</p>'

    root.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((b) =>
      b.addEventListener('click', async () => {
        const text = agenda.notes.find((n) => n.id === b.dataset.share)?.text ?? ''
        // The share sheet sends it to email, messages and so on; otherwise copy.
        try {
          if (navigator.share) return await navigator.share({ title: 'From Jarvis', text })
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return
        }
        try {
          await navigator.clipboard.writeText(text)
          b.textContent = 'Copied'
        } catch {
          b.textContent = 'Copy failed'
        }
        setTimeout(() => (b.textContent = 'Share'), 1500)
      }),
    )
    root.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((b) =>
      b.addEventListener('click', () => void agenda.remove('notes', [b.dataset.delete!])),
    )
  }
  agenda.onChange(render)
  render()
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
