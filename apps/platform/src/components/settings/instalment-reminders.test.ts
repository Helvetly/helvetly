import { expect, test } from 'vitest'

import { reminderDays } from './instalment-reminders'

test.each([
  ['3, 10', [3, 10]],
  ['10, 3 ,3', [3, 10]],
  ['3; 1x 0 -2', [3]],
  ['', []],
])('reminder days of %j', (typed, days) => {
  expect(reminderDays(typed)).toEqual(days)
})
