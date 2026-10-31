/**
 * Arithmetic and unit conversion, done on the phone: instant, exact, and
 * working with no connection. Takes the raw transcript ("what's 15% of 84?",
 * "5 miles in km") because normalising would strip the % and decimal points.
 */

/** "what's 15% of 84" → "12.6". Returns null unless the whole phrase is a sum. */
export function calculate(raw: string): string | null {
  const expr = toExpression(raw)
  if (!expr || !/[-+*/^]|sqrt/.test(expr) || !/\d/.test(expr)) return null
  try {
    const value = evaluate(expr)
    return Number.isFinite(value) ? formatNumber(value) : null
  } catch {
    return null
  }
}

/** For the Gemini tool: evaluates an expression it writes itself. */
export function calculateTool({ expression }: { expression: string }) {
  const value = calculate(expression)
  return value == null ? { error: `Could not evaluate "${expression}".` } : { result: value }
}

const WORD_OPS: [RegExp, string][] = [
  [/\bsquare root of\s*/g, 'sqrt '],
  [/\bcube root of\s*/g, 'cbrt '],
  [/\bto the power of\b|\bto the\b|\braised to\b/g, '^'],
  [/\bsquared\b/g, '^2'],
  [/\bcubed\b/g, '^3'],
  [/\bplus\b|\band\b/g, '+'],
  [/\bminus\b|\btake away\b|\bless\b/g, '-'],
  [/\bmultiplied by\b|\btimes\b/g, '*'],
  [/\bdivided by\b|\bover\b/g, '/'],
  [/\bpercent\b/g, '%'],
]

function toExpression(raw: string): string | null {
  let s = raw
    .toLowerCase()
    .replace(/^\s*(?:hey |ok |okay )?(?:edith|edit|jarvis)[,.!]?\s*/, '')
    .replace(/^(?:what(?:'s| is)|whats|calculate|compute|work out|how much is|tell me)\s+/, '')
    .replace(/[?!]+$|\.$/g, '')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[×x](?=\s*[\d(])/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .trim()
  for (const [re, op] of WORD_OPS) s = s.replace(re, op)
  // "15% of 84" → "(15/100)*84"; a trailing "%" elsewhere is a percentage.
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s*of\b/g, '($1/100)*').replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)')
  s = s.replace(/\s+/g, '')
  return /^(?:[\d.+\-*/^()]|sqrt|cbrt)*$/.test(s) ? s : null
}

/** Recursive descent: + - over * / over unary minus over ^ (right-associative). */
function evaluate(src: string): number {
  let i = 0
  const peek = () => src[i]
  const eat = (c: string) => (src.startsWith(c, i) ? ((i += c.length), true) : false)

  const expr = (): number => {
    let v = term()
    for (;;) {
      if (eat('+')) v += term()
      else if (eat('-')) v -= term()
      else return v
    }
  }
  const term = (): number => {
    let v = unary()
    for (;;) {
      if (eat('*')) v *= unary()
      else if (eat('/')) v /= unary()
      else return v
    }
  }
  const unary = (): number => (eat('-') ? -unary() : eat('+') ? unary() : power())
  const power = (): number => {
    const base = atom()
    return eat('^') ? base ** unary() : base
  }
  const atom = (): number => {
    if (eat('sqrt')) return Math.sqrt(atom())
    if (eat('cbrt')) return Math.cbrt(atom())
    if (eat('(')) {
      const v = expr()
      if (!eat(')')) throw new Error('missing )')
      return v
    }
    const m = /^\d*\.?\d+/.exec(src.slice(i))
    if (!m) throw new Error(`unexpected ${peek() ?? 'end'}`)
    i += m[0].length
    return Number(m[0])
  }

  const v = expr()
  if (i !== src.length) throw new Error('trailing input')
  return v
}

export const formatNumber = (n: number) => {
  if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-4)) return n.toExponential(4)
  return n.toLocaleString('en-GB', { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 4 })
}

// ── Units ──────────────────────────────────────────────────────────

type Unit = { dim: string; factor: number; label: string }

// Factors are to the SI-ish base of each dimension (m, kg, l, m/s, s, B, m², J).
// Pints and gallons are imperial (UK); say "US pints" for the US ones.
const UNITS: Record<string, Unit> = {}
const def = (dim: string, factor: number, label: string, ...names: string[]) => {
  for (const n of [label, ...names]) UNITS[n] = { dim, factor, label }
}
def('length', 0.001, 'mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters')
def('length', 0.01, 'cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters')
def('length', 1, 'm', 'metre', 'metres', 'meter', 'meters')
def('length', 1000, 'km', 'kilometre', 'kilometres', 'kilometer', 'kilometers', 'k')
def('length', 0.0254, 'in', 'inch', 'inches')
def('length', 0.3048, 'ft', 'foot', 'feet')
def('length', 0.9144, 'yd', 'yard', 'yards')
def('length', 1609.344, 'miles', 'mile', 'mi')
def('length', 1852, 'nautical miles', 'nautical mile', 'nmi')
def('mass', 0.000001, 'mg', 'milligram', 'milligrams')
def('mass', 0.001, 'g', 'gram', 'grams', 'gramme', 'grammes')
def('mass', 1, 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms')
def('mass', 0.0283495, 'oz', 'ounce', 'ounces')
def('mass', 0.453592, 'lb', 'lbs', 'pound', 'pounds')
def('mass', 6.35029, 'stone', 'stones', 'st')
def('mass', 1000, 'tonnes', 'tonne', 'metric ton', 'metric tons')
def('volume', 0.001, 'ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters')
def('volume', 0.01, 'cl', 'centilitre', 'centilitres')
def('volume', 1, 'litres', 'l', 'litre', 'liter', 'liters')
def('volume', 0.00492892, 'tsp', 'teaspoon', 'teaspoons')
def('volume', 0.0147868, 'tbsp', 'tablespoon', 'tablespoons')
def('volume', 0.24, 'cups', 'cup')
def('volume', 0.0284131, 'fl oz', 'fluid ounce', 'fluid ounces')
def('volume', 0.568261, 'pints', 'pint')
def('volume', 0.473176, 'US pints', 'us pint', 'us pints')
def('volume', 4.54609, 'gallons', 'gallon')
def('volume', 3.78541, 'US gallons', 'us gallon', 'us gallons')
def('speed', 1, 'm/s', 'metres per second', 'meters per second')
def('speed', 1 / 3.6, 'km/h', 'kph', 'kmh', 'kilometres per hour', 'kilometers per hour')
def('speed', 0.44704, 'mph', 'miles per hour')
def('speed', 0.514444, 'knots', 'knot', 'kn')
def('time', 1, 'seconds', 'second', 'secs', 'sec', 's')
def('time', 60, 'minutes', 'minute', 'mins', 'min')
def('time', 3600, 'hours', 'hour', 'hrs', 'hr', 'h')
def('time', 86400, 'days', 'day')
def('time', 604800, 'weeks', 'week')
def('time', 31557600, 'years', 'year')
def('data', 1, 'bytes', 'byte', 'b')
def('data', 1e3, 'KB', 'kb', 'kilobyte', 'kilobytes')
def('data', 1e6, 'MB', 'mb', 'megabyte', 'megabytes', 'megs')
def('data', 1e9, 'GB', 'gb', 'gigabyte', 'gigabytes', 'gigs')
def('data', 1e12, 'TB', 'tb', 'terabyte', 'terabytes')
def('area', 1, 'm²', 'square metre', 'square metres', 'square meter', 'square meters', 'sq m')
def('area', 0.092903, 'sq ft', 'square foot', 'square feet')
def('area', 1e6, 'km²', 'square kilometre', 'square kilometres', 'square kilometer', 'square kilometers', 'sq km')
def('area', 2589988, 'sq mi', 'square mile', 'square miles')
def('area', 4046.86, 'acres', 'acre')
def('area', 10000, 'hectares', 'hectare', 'ha')
def('energy', 4184, 'kcal', 'calorie', 'calories', 'kilocalorie', 'kilocalories', 'cal')
def('energy', 1000, 'kJ', 'kj', 'kilojoule', 'kilojoules')
def('energy', 3.6e6, 'kWh', 'kwh', 'kilowatt hour', 'kilowatt hours')

const TEMPS: Record<string, string> = {
  c: 'C', celsius: 'C', centigrade: 'C', 'degrees c': 'C', 'degrees celsius': 'C',
  f: 'F', fahrenheit: 'F', 'degrees f': 'F', 'degrees fahrenheit': 'F',
  k: 'K', kelvin: 'K', kelvins: 'K',
}
const toCelsius = { C: (v: number) => v, F: (v: number) => ((v - 32) * 5) / 9, K: (v: number) => v - 273.15 }
const fromCelsius = { C: (v: number) => v, F: (v: number) => (v * 9) / 5 + 32, K: (v: number) => v + 273.15 }

/** "5 miles in km", "convert 180 cm to feet", "how many grams in 3 ounces". */
export function convertUnits(raw: string): string | null {
  const s = raw
    .toLowerCase()
    .replace(/^\s*(?:hey |ok |okay )?(?:edith|edit|jarvis)[,.!]?\s*/, '')
    .replace(/[?!]+$|\.$/g, '')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/°\s*/g, 'degrees ')
    .replace(/\s+/g, ' ')
    .trim()
  const num = '(-?\\d*\\.?\\d+|an?|one|half a)'
  const unit = '([a-z²/ ]+?)'
  const patterns = [
    new RegExp(`^(?:convert |what(?:'s| is) |whats )?${num} ?${unit} (?:in|to|into|as) (?:a |an )?${unit}$`),
    new RegExp(`^how many ${unit} (?:are |is )?(?:in|to) ${num} ?${unit}$`),
  ]
  let amount: string, from: string, to: string
  let m = patterns[0].exec(s)
  if (m) [amount, from, to] = [m[1], m[2], m[3]]
  else if ((m = patterns[1].exec(s))) [to, amount, from] = [m[1], m[2], m[3]]
  else return null
  const value = amount === 'half a' ? 0.5 : /^(?:an?|one)$/.test(amount) ? 1 : Number(amount)
  if (!Number.isFinite(value)) return null
  from = from.trim()
  to = to.trim()

  const tf = TEMPS[from]
  const tt = TEMPS[to]
  if (tf && tt) {
    const out = fromCelsius[tt as 'C'](toCelsius[tf as 'C'](value))
    const deg = (u: string) => (u === 'K' ? ' K' : `°${u}`)
    return `${formatNumber(value)}${deg(tf)} is ${formatNumber(Math.round(out * 10) / 10)}${deg(tt)}.`
  }
  const a = UNITS[from] ?? UNITS[from.replace(/s$/, '')]
  const b = UNITS[to] ?? UNITS[to.replace(/s$/, '')]
  if (!a || !b || a.dim !== b.dim) return null
  const out = (value * a.factor) / b.factor
  const rounded = Math.abs(out) >= 100 ? Math.round(out * 10) / 10 : Number(out.toPrecision(4))
  // "1 pint", "2 pints" (but "1 m/s").
  const name = (u: Unit, n: number) => (n === 1 && /[a-z]s$/i.test(u.label) ? u.label.slice(0, -1) : u.label)
  return `${formatNumber(value)} ${name(a, value)} is ${formatNumber(rounded)} ${name(b, rounded)}.`
}
