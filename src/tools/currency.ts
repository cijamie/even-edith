import { requestJson } from '../net/http'

export const currencyDeclaration = {
  name: 'convert_currency',
  description: 'Convert an amount between currencies using daily exchange rates.',
  parameters: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      from: { type: 'string', description: 'ISO 4217 code, e.g. USD' },
      to: { type: 'string', description: 'ISO 4217 code, e.g. GBP' },
    },
    required: ['amount', 'from', 'to'],
  },
}

const cache = new Map<string, { at: number; rates: Record<string, number> }>()

export async function convertCurrency({ amount, from, to }: { amount: number; from: string; to: string }) {
  const base = from.toUpperCase()
  const target = to.toUpperCase()
  let entry = cache.get(base)
  if (!entry || Date.now() - entry.at > 3600_000) {
    const body = await requestJson<any>(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`)
    if (body?.result !== 'success') return { error: `Unknown currency ${base}.` }
    entry = { at: Date.now(), rates: body.rates }
    cache.set(base, entry)
  }
  const rate = entry.rates[target]
  if (!rate) return { error: `Unknown currency ${target}.` }
  return { amount, from: base, to: target, rate, result: Math.round(amount * rate * 100) / 100 }
}
