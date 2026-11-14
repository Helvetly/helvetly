import { chatTime, filterChats, groupChats } from './chat-history'

const now = new Date(2026, 10, 11, 14, 0)
const chat = (id: string, at: Date, title = id, snippet = '') => ({
  id,
  title,
  snippet,
  updated_at: at.toISOString(),
})

test('groups chats by calendar day and leaves empty groups out', () => {
  const groups = groupChats(
    [
      chat('a', new Date(2026, 10, 11, 0, 5)),
      chat('b', new Date(2026, 10, 10, 23, 59)),
      chat('c', new Date(2026, 10, 5, 9, 0)),
      chat('d', new Date(2026, 10, 4, 9, 0)),
      chat('e', new Date(2025, 0, 1)),
    ],
    now,
  )
  expect(groups.map((group) => [group.label, group.chats.map((item) => item.id)])).toEqual([
    ['Today', ['a']],
    ['Yesterday', ['b']],
    ['Previous 7 days', ['c']],
    ['Older', ['d', 'e']],
  ])
  expect(groupChats([chat('x', new Date(2026, 9, 1))], now).map((group) => group.label)).toEqual([
    'Older',
  ])
})

test('filters by the question and the latest answer, ignoring case and blank terms', () => {
  const chats = [
    chat('a', now, 'Which invoices are overdue?', 'Two invoices are overdue.'),
    chat('b', now, 'hi', 'Hello! How can I help with Müller AG?'),
  ]
  expect(filterChats(chats, '  ')).toEqual(chats)
  expect(filterChats(chats, 'OVERDUE').map((item) => item.id)).toEqual(['a'])
  expect(filterChats(chats, 'müller').map((item) => item.id)).toEqual(['b'])
  expect(filterChats(chats, 'nothing')).toEqual([])
})

test('shows the clock for today and yesterday, the day before, and the year when not this one', () => {
  expect(chatTime(new Date(2026, 10, 11, 8, 31), now)).toBe('08:31')
  expect(chatTime(new Date(2026, 10, 10, 17, 5), now)).toBe('17:05')
  expect(chatTime(new Date(2026, 10, 3, 9, 0), now)).toBe('3 Nov')
  expect(chatTime(new Date(2025, 11, 30, 9, 0), now)).toBe('30 Dec 2025')
})
