import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertUnits, evaluate, fmt, quickAnswer, tipSplit } from '../src/tools/calc.ts'

test('evaluate: precedence, powers and brackets', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14)
  assert.equal(evaluate('(2 + 3) * 4'), 20)
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512) // right-associative
  assert.equal(evaluate('2(3+4)'), 14) // implied multiplication
  assert.equal(evaluate('-3 + 5'), 2)
  assert.equal(evaluate('10 / 4'), 2.5)
})

test('evaluate: spoken words', () => {
  assert.equal(evaluate('12 times 3'), 36)
  assert.equal(evaluate('7 x 6'), 42)
  assert.equal(evaluate('100 divided by 8'), 12.5)
  assert.equal(evaluate('square root of 81'), 9)
  assert.equal(evaluate('5 squared'), 25)
  assert.equal(evaluate('2 cubed'), 8)
  assert.equal(evaluate('3 to the power of 4'), 81)
  assert.equal(evaluate('9 plus 1 minus 4'), 6)
})

test('evaluate: percentages, currency and thousands', () => {
  assert.equal(evaluate('15% of 80'), 12)
  assert.equal(evaluate('17.5 percent of 240'), 42)
  assert.equal(evaluate('£1,200 + £300'), 1500)
  assert.equal(evaluate('200 + 10%'), 200.1) // a bare percent is a fraction, not "add 10%"
})

test('evaluate: refuses things that are not maths', () => {
  assert.throws(() => evaluate('what is the weather'))
  assert.throws(() => evaluate(''))
  assert.throws(() => evaluate('(2 + 3'))
  assert.throws(() => evaluate('1 / 0'))
  assert.throws(() => evaluate('alert(1)'))
})

test('fmt: rounding and separators', () => {
  assert.equal(fmt(1234.5678), '1,234.57')
  assert.equal(fmt(0.123456), '0.1235')
  assert.equal(fmt(2), '2')
  assert.equal(fmt(1e13), '1.000e+13')
})

test('convertUnits', () => {
  assert.equal(convertUnits({ value: 5, from: 'miles', to: 'km' }).result, 8.04672)
  assert.equal(convertUnits({ value: 100, from: 'celsius', to: 'fahrenheit' }).result, 212)
  assert.equal(convertUnits({ value: 32, from: 'f', to: 'c' }).result, 0)
  assert.equal(convertUnits({ value: 1, from: 'stone', to: 'lb' }).result, 14)
  assert.equal(convertUnits({ value: 2, from: 'cup', to: 'ml' }).result, 473.176)
  assert.ok('error' in convertUnits({ value: 1, from: 'kg', to: 'km' }))
  assert.ok('error' in convertUnits({ value: 1, from: 'florp', to: 'km' }))
})

test('tipSplit', () => {
  assert.deepEqual(tipSplit({ amount: 84, people: 3, tipPercent: 12 }), { tip: 10.08, total: 94.08, eachPerson: 31.36, people: 3 })
  assert.ok('error' in tipSplit({ amount: 0 }))
  assert.ok('error' in tipSplit({ amount: 10, people: 0 }))
})

test('quickAnswer: phrasings it should answer', () => {
  assert.equal(quickAnswer("What's 15% of 80?"), '12.')
  assert.equal(quickAnswer('EDITH, what is 12 times 12'), '144.')
  assert.equal(quickAnswer('5 miles in km'), '5 miles is 8.0467 km.')
  assert.equal(quickAnswer('how many feet in 3 metres'), '3 metres is 9.8425 feet.')
  assert.equal(quickAnswer('split £84 between 3 with a 12% tip'), '£31.36 each, £94.08 total with a £10.08 tip.')
  assert.equal(quickAnswer('split 60 between 4'), '15 each.')
  assert.equal(quickAnswer('20% tip on £45'), 'Tip £9, total £54.')
  assert.equal(quickAnswer('2.5 + 2.5?'), '5.')
})

test('quickAnswer: leaves everything else to Gemini', () => {
  for (const q of ["what's the weather", 'set a timer for 5 minutes', '42', 'who won the match', 'navigate to 10 Downing Street', 'I spent £12 on lunch']) {
    assert.equal(quickAnswer(q), null, q)
  }
})
