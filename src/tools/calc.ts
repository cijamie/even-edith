/**
 * Offline maths: arithmetic, unit conversion, tips and bill splits. Runs before
 * Gemini for simple requests, so they answer instantly and with no signal.
 */

// ── Arithmetic ─────────────────────────────────────────────────────

const WORDS: [RegExp, string][] = [
  [/\bsquare root of\s*/g, 'sqrt '],
  [/\bto the power of\b/g, '^'],
  [/\bsquared\b/g, '^2'],
  [/\bcubed\b/g, '^3'],
  [/\b(?:multiplied by|times)\b/g, '*'],
  [/(\d)\s*x\s*(?=\d)/g, '$1*'],
  [/\b(?:divided by|over)\b/g, '/'],
  [/\bplus\b/g, '+'],
  [/\bminus\b/g, '-'],
  [/(\d(?:[\d.]*))\s*(?:%|percent)\s*of\b/g, '$1/100*'],
  [/(\d(?:[\d.]*))\s*(?:%|percent)/g, '($1/100)'],
  [/[×]/g, '*'],
  [/[÷]/g, '/'],
  [/(\d),(?=\d{3}\b)/g, '$1'], // thousands separators
]

/** Evaluates + - * / ^ and parentheses, sqrt, with a hand-written parser (no eval). */
export function evaluate(input: string): number {
  let s = input.toLowerCase()
  for (const [re, to] of WORDS) s = s.replace(re, to)
  s = s.replace(/[£$€¥]/g, '')
  const tokens = s.match(/sqrt|\d*\.?\d+(?:e[+-]?\d+)?|[-+*/^()]/g) ?? []
  // Anything left over that isn't a token means this isn't plain maths.
  if (s.replace(/sqrt|\d*\.?\d+(?:e[+-]?\d+)?|[-+*/^()\s]/g, '').length) throw new Error('not arithmetic')
  let i = 0
  const peek = () => tokens[i]
  const next = () => tokens[i++]

  const primary = (): number => {
    const t = next()
    if (t === '(') {
      const v = sum()
      if (next() !== ')') throw new Error('missing )')
      return v
    }
    if (t === '-') return -power()
    if (t === '+') return power()
    if (t === 'sqrt') return Math.sqrt(power())
    if (t != null && /\d/.test(t)) return Number(t)
    throw new Error('unexpected ' + t)
  }
  const power = (): number => {
    const base = primary()
    if (peek() === '^') {
      next()
      return base ** power()
    }
    return base
  }
  const product = (): number => {
    let v = power()
    while (peek() === '*' || peek() === '/' || peek() === '(') {
      const op = peek() === '(' ? '*' : next() // "2(3+4)"
      const r = power()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + product() : v - product()
    return v
  }

  if (!tokens.length) throw new Error('empty')
  const v = sum()
  if (i !== tokens.length || !Number.isFinite(v)) throw new Error('could not evaluate')
  return v
}

export const fmt = (n: number) => {
  if (Math.abs(n) >= 1e12 || (Math.abs(n) < 1e-4 && n !== 0)) return n.toExponential(3)
  return Number(n.toFixed(Math.abs(n) >= 100 ? 2 : 4)).toLocaleString('en-GB', { maximumFractionDigits: 4 })
}

// ── Units ──────────────────────────────────────────────────────────

type Unit = { dim: string; factor: number }
const U: Record<string, Unit> = {}
const def = (dim: string, factor: number, ...names: string[]) => names.forEach((n) => (U[n] = { dim, factor }))
// length (m)
def('length', 1, 'm', 'meter', 'meters', 'metre', 'metres')
def('length', 1000, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'k')
def('length', 0.01, 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres')
def('length', 0.001, 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres')
def('length', 1609.344, 'mi', 'mile', 'miles')
def('length', 0.9144, 'yd', 'yard', 'yards')
def('length', 0.3048, 'ft', 'foot', 'feet')
def('length', 0.0254, 'in', 'inch', 'inches')
def('length', 1852, 'nmi', 'nautical mile', 'nautical miles')
// mass (kg)
def('mass', 1, 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms')
def('mass', 0.001, 'g', 'gram', 'grams')
def('mass', 0.45359237, 'lb', 'lbs', 'pound', 'pounds')
def('mass', 0.028349523125, 'oz', 'ounce', 'ounces')
def('mass', 6.35029318, 'st', 'stone', 'stones')
def('mass', 1000, 't', 'tonne', 'tonnes')
// volume (l)
def('volume', 1, 'l', 'liter', 'liters', 'litre', 'litres')
def('volume', 0.001, 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres')
def('volume', 0.56826125, 'pint', 'pints', 'uk pint', 'uk pints')
def('volume', 0.473176473, 'us pint', 'us pints')
def('volume', 4.54609, 'gallon', 'gallons', 'uk gallon', 'uk gallons')
def('volume', 3.785411784, 'us gallon', 'us gallons')
def('volume', 0.2365882365, 'cup', 'cups')
def('volume', 0.0147867648, 'tbsp', 'tablespoon', 'tablespoons')
def('volume', 0.00492892159, 'tsp', 'teaspoon', 'teaspoons')
def('volume', 0.0295735296, 'fl oz', 'fluid ounce', 'fluid ounces')
// speed (m/s)
def('speed', 1, 'm/s', 'meters per second', 'metres per second')
def('speed', 1000 / 3600, 'km/h', 'kph', 'kmh', 'kilometers per hour', 'kilometres per hour')
def('speed', 1609.344 / 3600, 'mph', 'miles per hour')
def('speed', 1852 / 3600, 'knot', 'knots')
// area (m²)
def('area', 1, 'm2', 'square meter', 'square meters', 'square metre', 'square metres', 'sq m')
def('area', 0.09290304, 'ft2', 'square foot', 'square feet', 'sq ft')
def('area', 4046.8564224, 'acre', 'acres')
def('area', 10000, 'ha', 'hectare', 'hectares')
// data (bytes)
def('data', 1, 'b', 'byte', 'bytes')
def('data', 1e3, 'kb', 'kilobyte', 'kilobytes')
def('data', 1e6, 'mb', 'megabyte', 'megabytes')
def('data', 1e9, 'gb', 'gigabyte', 'gigabytes')
def('data', 1e12, 'tb', 'terabyte', 'terabytes')
// time (s)
def('time', 1, 's', 'sec', 'secs', 'second', 'seconds')
def('time', 60, 'min', 'mins', 'minute', 'minutes')
def('time', 3600, 'h', 'hr', 'hrs', 'hour', 'hours')
def('time', 86400, 'day', 'days')
def('time', 604800, 'week', 'weeks')

const TEMP: Record<string, 'c' | 'f' | 'k'> = {
  c: 'c', celsius: 'c', centigrade: 'c', degrees: 'c', 'degrees c': 'c', 'degrees celsius': 'c', '°c': 'c',
  f: 'f', fahrenheit: 'f', 'degrees f': 'f', 'degrees fahrenheit': 'f', '°f': 'f',
  k: 'k', kelvin: 'k',
}

const unitName = (s: string) => s.toLowerCase().replace(/\.$/, '').trim()

export function convertUnits({ value, from, to }: { value: number; from: string; to: string }) {
  const a = unitName(from)
  const b = unitName(to)
  if (TEMP[a] && TEMP[b]) {
    const c = TEMP[a] === 'c' ? value : TEMP[a] === 'f' ? ((value - 32) * 5) / 9 : value - 273.15
    const out = TEMP[b] === 'c' ? c : TEMP[b] === 'f' ? (c * 9) / 5 + 32 : c + 273.15
    return { value, from, to, result: Math.round(out * 10) / 10 }
  }
  const ua = U[a] ?? U[a.replace(/s$/, '')]
  const ub = U[b] ?? U[b.replace(/s$/, '')]
  if (!ua || !ub) return { error: `I don't know the unit "${!ua ? from : to}".` }
  if (ua.dim !== ub.dim) return { error: `Can't convert ${ua.dim} to ${ub.dim}.` }
  return { value, from, to, result: Number(((value * ua.factor) / ub.factor).toPrecision(6)) }
}

// ── Tips and bill splits ───────────────────────────────────────────

export function tipSplit({ amount, tipPercent = 0, people = 1 }: { amount: number; tipPercent?: number; people?: number }) {
  if (!(amount > 0) || !(people >= 1)) return { error: 'Need a positive amount and at least one person.' }
  const tip = (amount * tipPercent) / 100
  const total = amount + tip
  return {
    tip: round2(tip),
    total: round2(total),
    eachPerson: round2(total / Math.round(people)),
    people: Math.round(people),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

// ── Quick answers ──────────────────────────────────────────────────

const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)'
const num = (s: string) => Number(s.replace(/,/g, ''))

/**
 * Answers simple maths phrasings locally ("what's 15% of 80", "5 miles in km",
 * "split 84 between 3 with a 12% tip"). Returns null for anything else so it
 * falls through to Gemini.
 */
export function quickAnswer(spoken: string): string | null {
  // Takes the raw transcript: decimals, % and operators must survive.
  const c = spoken
    .toLowerCase()
    .trim()
    .replace(/[?!]+$|(?<!\d)\.$/g, '')
    .replace(/^(?:(?:hey|ok|okay)\s+)?(?:edith|jarvis|friday)[,.]?\s*/, '')
    .replace(/^(?:what['’]?s|what is|calculate|how much is|work out|convert)\s+/, '')
    .trim()

  // Bill split, with or without tip.
  let m = c.match(new RegExp(`^split (?:a |the )?([£$€]?)${NUM}(?: bill)? (?:between|among|by|for|with) ${NUM}(?: people| ways)?(?: (?:with|plus|and) (?:a )?${NUM}\\s*(?:%|percent) tip)?$`))
  if (m) {
    const r = tipSplit({ amount: num(m[2]), people: num(m[3]), tipPercent: m[4] ? num(m[4]) : 0 })
    if ('error' in r) return null
    const $ = m[1]
    return `${$}${money(r.eachPerson)} each${m[4] ? `, ${$}${money(r.total)} total with a ${$}${money(r.tip)} tip` : ''}.`
  }

  // Tip on an amount.
  m = c.match(new RegExp(`^(?:a )?${NUM}\\s*(?:%|percent) tip (?:on|for) (?:a )?([£$€]?)${NUM}(?: bill)?$`))
  if (m) {
    const r = tipSplit({ amount: num(m[3]), tipPercent: num(m[1]) })
    if ('error' in r) return null
    return `Tip ${m[2]}${money(r.tip)}, total ${m[2]}${money(r.total)}.`
  }

  // Unit conversion: "5 miles in km", "how many feet in 3 metres".
  m = c.match(new RegExp(`^${NUM}\\s*([a-z°/ ]+?) (?:in|to|into|as) ([a-z°/ ]+)$`))
  const many = c.match(new RegExp(`^how many ([a-z°/ ]+?) (?:are )?in (?:a |an |one )?${NUM}?\\s*([a-z°/ ]+)$`))
  const conv = m ? { value: num(m[1]), from: m[2], to: m[3] } : many ? { value: many[2] ? num(many[2]) : 1, from: many[3], to: many[1] } : null
  if (conv) {
    const r = convertUnits(conv)
    if (!('error' in r)) return `${fmt(conv.value)} ${conv.from.trim()} is ${fmt(r.result)} ${conv.to.trim()}.`
  }

  // Plain arithmetic: needs at least one operator so "42" alone isn't an answer.
  if (/[\d)]\s*(?:[-+*/^x×÷]|times|plus|minus|divided|over|percent|%|squared|cubed|to the power)|square root/.test(c)) {
    try {
      return `${fmt(evaluate(c))}.`
    } catch {
      return null
    }
  }
  return null
}
