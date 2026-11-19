import { formatDate } from '@helvetly/ui/lib/format'

import { entryDateBounds, entryDateProblem } from './entry-date'

const open = { start_date: '2026-11-19', end_date: null, cancelled_on: null }
const ended = { start_date: '2026-11-01', end_date: '2026-11-30', cancelled_on: '2026-11-10' }
const today = '2026-11-20'

test('bounds run from the start to today, or to an earlier last day', () => {
  expect(entryDateBounds(open, today)).toMatchObject({ min: '2026-11-19', max: today })
  expect(entryDateBounds(ended, today)).toMatchObject({ min: '2026-11-01', max: '2026-11-10' })
})

test.each([
  [open, '2026-11-19', null],
  [open, today, null],
  [open, '', 'Enter a date.'],
  [open, '2026-11-13', `Pick a date from ${formatDate('2026-11-19')} (the engagement's start).`],
  [open, '2026-11-21', `Pick a date up to today (${formatDate(today)}).`],
  [ended, '2026-11-11', `Pick a date up to ${formatDate('2026-11-10')} (the engagement's end).`],
])('%o on %s: %s', (engagement, date, problem) =>
  expect(entryDateProblem(date, entryDateBounds(engagement, today))).toBe(problem),
)
