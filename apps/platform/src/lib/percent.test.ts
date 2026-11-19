import { expect, test } from 'vitest'

import { typedPercent } from './percent'

test.each([
  ['', '5', '', false],
  ['5', '', '5', false],
  ['12.5', '12.', '12.5', false],
  ['12,25', '12,2', '12,25', false],
  ['100', '10', '100', false],
  ['0', '', '0', false],
  ['.5', '', '.5', false],
  [' 7.7% ', '', '7.7', false],
  ['s', '', '', true],
  ['5s', '5', '5', true],
  ['kkk2.6', '', '2.6', true],
  ['2.6k', '2.6', '2.6', true],
  ['101', '10', '100', true],
  ['150', '15', '100', true],
  ['100.01', '100.0', '100', true],
  ['12.345', '12.34', '12.34', true],
  ['1.2.3', '1.2', '1.2', true],
  ['-5', '', '', true],
  ['1000', '100', '100', true],
])('typing %j after %j shows %j (refused: %s)', (next, previous, value, refused) => {
  expect(typedPercent(next, previous)).toEqual({ value, refused })
})
