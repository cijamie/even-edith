import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseExpense, periodStart } from '../src/data/expenses.ts'
import { parseCards } from '../src/data/decks.ts'
import { followScript, wordsOf } from '../src/voice/follow.ts'
import { coach } from '../src/voice/coach.ts'

test('parseExpense', () => {
  assert.deepEqual(parseExpense('I spent £12 on lunch'), { amount: 12, currency: 'GBP', what: 'lunch' })
  assert.deepEqual(parseExpense('Jarvis, spent 4.50 on a coffee.'), { amount: 4.5, currency: undefined, what: 'coffee' })
  assert.deepEqual(parseExpense('I just paid 30 euros for petrol'), { amount: 30, currency: 'EUR', what: 'petrol' })
  assert.deepEqual(parseExpense('paid $8,99 for the cinema'), { amount: 8.99, currency: 'USD', what: 'cinema' })
  assert.equal(parseExpense('how much did I spend this week'), null)
  assert.equal(parseExpense('what is 12 times 3'), null)
})

test('periodStart: weeks start on Monday', () => {
  const wed = new Date(2026, 10, 4, 15, 30).getTime() // Wed 4 Nov 2026
  assert.equal(new Date(periodStart('today', wed)).getDate(), 4)
  assert.equal(new Date(periodStart('week', wed)).getDate(), 2)
  assert.equal(new Date(periodStart('month', wed)).getDate(), 1)
  const sun = new Date(2026, 10, 8, 9).getTime()
  assert.equal(new Date(periodStart('week', sun)).getDate(), 2)
})

test('parseCards: separators and junk lines', () => {
  assert.deepEqual(parseCards('Capital of France | Paris\nH2O\t Water\n\nno separator here\n2+2 :: 4\nDash - with - more'), [
    { q: 'Capital of France', a: 'Paris' },
    { q: 'H2O', a: 'Water' },
    { q: '2+2', a: '4' },
    { q: 'Dash', a: 'with - more' },
  ])
})

test('followScript: tracks reading, ignores noise, never goes back', () => {
  const script = wordsOf('Friends, thank you all for coming tonight. We built this company from a garage, and tonight we celebrate ten years of it.')
  let cursor = 0
  cursor = followScript(script, cursor, wordsOf('thank you all for coming'))
  assert.equal(script[cursor - 1], 'coming')
  const before = cursor
  cursor = followScript(script, cursor, wordsOf('banana spaceship'))
  assert.equal(cursor, before)
  cursor = followScript(script, cursor, wordsOf('from a garage and tonight'))
  assert.equal(script[cursor - 1], 'tonight')
  assert.ok(cursor > before)
  // "tonight" appears twice; a short repeat must not jump back to the first.
  assert.ok(followScript(script, cursor, wordsOf('coming tonight')) >= cursor)
})

test('coach: pace, fillers and talk share', () => {
  const said = [
    { text: 'So um I think we should like ship it, um, on Friday basically', seconds: 6, speaker: 'self' as const },
    { text: 'Okay that works for me and the team can test it on Thursday then', seconds: 6, speaker: 'other' as const },
    { text: 'Great, I mean, let us do it and write the release notes today', seconds: 18, speaker: 'self' as const },
  ]
  const out = coach(said)
  assert.match(out, /^Coach: You talked 80% of the time/)
  assert.match(out, /um ×2/)
  assert.match(out, /words a minute/)
  assert.equal(coach([{ text: 'hi', seconds: 3, speaker: 'self' }]), '') // too short to judge
})
