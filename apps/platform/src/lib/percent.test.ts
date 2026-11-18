import { expect, test } from 'vitest'

import { typedPercent } from './percent'

test.each([
  ['', '5', ''],
  ['5', '', '5'],
  ['12.5', '12.', '12.5'],
  ['12,25', '12,2', '12,25'],
  ['100', '10', '100'],
  ['0', '', '0'],
  ['.5', '', '.5'],
  ['s', '', ''],
  ['5s', '5', '5'],
  ['101', '10', '10'],
  ['100.01', '100.0', '100.0'],
  ['12.345', '12.34', '12.34'],
  ['-5', '', ''],
  ['1000', '100', '100'],
])('typing %j after %j shows %j', (next, previous, shown) => {
  expect(typedPercent(next, previous)).toBe(shown)
})
