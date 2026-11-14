import { messageTime } from './message'

test('shows the clock for today and the day as well for another day', () => {
  const now = new Date(2026, 10, 11, 9, 0)
  expect(messageTime(new Date(2026, 10, 11, 8, 31), now)).toBe('08:31')
  expect(messageTime(new Date(2026, 10, 10, 17, 5), now)).toBe('10 Nov, 17:05')
})
