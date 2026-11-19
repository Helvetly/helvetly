import { expect, test } from 'vitest'

import { typedAmount } from './amount'

test.each([
  ['', '5', '', false],
  ['22', '2', '22', false],
  ['1234.5', '1234.', '1234.5', false],
  ['12,25', '12,2', '12,25', false],
  ["1'234.50", "1'234.5", "1'234.50", false],
  ['22s', '22', '22', true],
  ['22ssss', '', '22', true],
  ['CHF 49.90', '', '49.90', true],
  ['12.345', '12.34', '12.34', true],
  ['1.2.3', '1.2', '1.2', true],
  ['-5', '', '', true],
])('typing %j after %j shows %j (refused: %s)', (next, previous, value, refused) => {
  expect(typedAmount(next, previous)).toEqual({ value, refused })
})
