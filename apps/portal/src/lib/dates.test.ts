import { civilToday, daysBetween, daysLeftText, dueText, greeting, sharedText } from './dates'

test('civilToday is the local calendar day, zero-padded', () => {
  expect(civilToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
})

test.each([
  ['2026-11-10', '2026-11-10', 0],
  ['2026-11-10', '2026-11-15', 5],
  ['2026-11-10', '2026-10-29', -12],
  // Across the October DST change and a year end.
  ['2026-10-24', '2026-10-26', 2],
  ['2026-12-31', '2027-01-01', 1],
])('daysBetween(%s, %s) = %i', (from, to, expected) => {
  expect(daysBetween(from, to)).toBe(expected)
})

test.each([
  ['2026-11-10', 'Due today'],
  ['2026-11-11', 'Due tomorrow'],
  ['2026-11-15', 'Due in 5 days'],
  ['2026-11-09', '1 day overdue'],
  ['2026-10-29', '12 days overdue'],
])('dueText(%s) on 2026-11-10 is "%s"', (due, expected) => {
  expect(dueText(due, '2026-11-10')).toBe(expected)
})

test.each([
  ['2026-11-30', '20 days left'],
  ['2026-11-11', '1 day left'],
  ['2026-11-10', 'Last day'],
  ['2026-11-09', 'Ended'],
])('daysLeftText(%s) on 2026-11-10 is "%s"', (endsOn, expected) => {
  expect(daysLeftText(endsOn, '2026-11-10')).toBe(expected)
})

test.each([
  [0, 'Good morning'],
  [11, 'Good morning'],
  [12, 'Good afternoon'],
  [17, 'Good afternoon'],
  [18, 'Good evening'],
])('greeting at %i:00 is "%s"', (hour, expected) => {
  expect(greeting(hour)).toBe(expected)
})

test.each([
  ['2026-11-10T08:00:00Z', 'Shared today'],
  ['2026-11-09T08:00:00Z', 'Shared yesterday'],
  ['2026-11-07T08:00:00Z', 'Shared 3 days ago'],
  ['2026-10-05T09:00:00Z', 'Shared 5 Oct 2026'],
])('sharedText(%s) on 2026-11-10 is "%s"', (sharedAt, expected) => {
  expect(sharedText(sharedAt, '2026-11-10')).toBe(expected)
})
