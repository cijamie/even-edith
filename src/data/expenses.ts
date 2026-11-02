import type { Store } from '../store'

export type Expense = { id: string; amount: number; currency: string; what: string; at: number }
export type Period = 'today' | 'week' | 'month'

const KEY = 'edith.expenses'
const shortId = () => Math.random().toString(36).slice(2, 7)

export const SYMBOL: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', INR: '₹' }
const FROM_SYMBOL: Record<string, string> = { '£': 'GBP', $: 'USD', '€': 'EUR', '¥': 'JPY', '₹': 'INR' }

export const money = (amount: number, currency: string) =>
  SYMBOL[currency] ? `${SYMBOL[currency]}${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`

/** Start of the period containing `now` (weeks start on Monday). */
export function periodStart(period: Period, now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  if (period === 'month') d.setDate(1)
  return d.getTime()
}

/** The phone's own currency, from its locale (en-GB → GBP). */
export function localCurrency() {
  const region = (navigator.language.split('-')[1] ?? '').toUpperCase()
  const map: Record<string, string> = { GB: 'GBP', US: 'USD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', JP: 'JPY', IN: 'INR', CA: 'CAD', AU: 'AUD' }
  return map[region] ?? 'GBP'
}

/**
 * "I spent £12 on lunch" / "spent 4.50 on coffee" / "£30 for petrol", parsed
 * locally so it logs instantly and offline. Returns null for anything else.
 */
export function parseExpense(spoken: string): { amount: number; currency?: string; what: string } | null {
  const c = spoken
    .trim()
    .replace(/[?!.]+$/g, '')
    .replace(/^(?:(?:hey|ok|okay)\s+)?(?:edith|jarvis|friday)[,.]?\s*/i, '')
  const m = c.match(/^(?:i (?:just )?(?:spent|paid)|spent|paid|log|expense)\s+([£$€¥₹]?)(\d+(?:[.,]\d{1,2})?)\s*(pounds?|quid|dollars?|euros?|bucks)?\s+(?:on|for)\s+(.+)$/i)
  if (!m) return null
  const word = (m[3] ?? '').toLowerCase()
  const currency = m[1] ? FROM_SYMBOL[m[1]] : /pound|quid/.test(word) ? 'GBP' : /dollar|buck/.test(word) ? 'USD' : /euro/.test(word) ? 'EUR' : undefined
  return { amount: Number(m[2].replace(',', '.')), currency, what: m[4].replace(/^(?:a|an|some|the)\s+/i, '').trim() }
}

/** Spending log: "I spent £12 on lunch", weekly totals on the phone. */
export class Expenses {
  private data: Expense[] = []
  private listeners: (() => void)[] = []

  constructor(private store: Store) {}

  async load() {
    this.data = await this.store.getJson<Expense[]>(KEY, [])
  }

  onChange(fn: () => void) {
    this.listeners.push(fn)
  }

  private async save() {
    await this.store.setJson(KEY, this.data)
    this.listeners.forEach((fn) => fn())
  }

  /** Newest first. */
  get all() {
    return [...this.data].sort((a, b) => b.at - a.at)
  }

  async add(amount: number, what: string, currency = localCurrency()) {
    const e: Expense = { id: shortId(), amount: Math.round(amount * 100) / 100, currency: currency.toUpperCase(), what, at: Date.now() }
    this.data.push(e)
    await this.save()
    return e
  }

  async remove(id: string) {
    const before = this.data.length
    this.data = this.data.filter((e) => e.id !== id)
    if (this.data.length < before) await this.save()
    return before - this.data.length
  }

  since(ms: number) {
    return this.all.filter((e) => e.at >= ms)
  }

  /** Totals per currency, e.g. "£42.50" or "£42.50 + €12.00". */
  total(items: Expense[]) {
    const sums = new Map<string, number>()
    for (const e of items) sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount)
    return [...sums].map(([c, n]) => money(n, c)).join(' + ') || money(0, localCurrency())
  }

  csv() {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    return ['date,amount,currency,what', ...this.all.map((e) => `${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')},${e.amount.toFixed(2)},${e.currency},${q(e.what)}`)].join('\n')
  }
}
