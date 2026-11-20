import { expect, test } from 'vitest'

import { amountOf, shortAmount } from './units'

test.each([
  [1, 'hour', '1 hour'],
  [10, 'hour', '10 hours'],
  ['2.5', 'day', '2.5 days'],
  [0, 'hour', '0 hours'],
  [3, 'km', '3 km'],
  [4, 'sessions', '4 sessions'],
  [4, null, '4'],
])('amountOf(%s, %s) is %s', (quantity, unit, want) => {
  expect(amountOf(quantity, unit)).toBe(want)
})

test.each([
  ['2', 'hour', '2 h'],
  ['1.50', 'day', '1.5 d'],
  ['4', 'sessions', '4 sessions'],
  ['4', null, '4'],
])('shortAmount(%s, %s) is %s', (quantity, unit, want) => {
  expect(shortAmount(quantity, unit)).toBe(want)
})
