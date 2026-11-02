import { money, periodStart, type Expenses } from '../data/expenses'

/** This week's spending with totals, delete, and a CSV export. */
export function mountExpenses(root: HTMLElement, expenses: Expenses) {
  const render = () => {
    const week = expenses.since(periodStart('week'))
    const today = expenses.since(periodStart('today'))
    const month = expenses.since(periodStart('month'))
    root.innerHTML = `
      <p class="totals">Today <b>${expenses.total(today)}</b> · Week <b>${expenses.total(week)}</b> · Month <b>${expenses.total(month)}</b></p>
      ${
        week.length
          ? `<ul class="facts">${week
              .map(
                (e) => `<li><span>${money(e.amount, e.currency)} ${escape(e.what)} <small>· ${new Date(e.at).toLocaleDateString('en-GB', { weekday: 'short' })}</small></span>
                  <button type="button" data-id="${e.id}">Delete</button></li>`,
              )
              .join('')}</ul>`
          : '<p class="hint">Nothing this week. Say "EDITH, I spent £12 on lunch".</p>'
      }
      <div class="actions"><button type="button" class="export"${expenses.all.length ? '' : ' disabled'}>Export CSV</button></div>`
    root.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => void expenses.remove(b.dataset.id!)))
    root.querySelector('.export')!.addEventListener('click', () => saveFile('edith-expenses.csv', expenses.csv(), 'text/csv'))
  }
  expenses.onChange(render)
  render()
}

/** Share sheet where there is one (phones), otherwise a download. */
export async function saveFile(name: string, text: string, type: string) {
  const file = new File([text], name, { type })
  try {
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: name })
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
