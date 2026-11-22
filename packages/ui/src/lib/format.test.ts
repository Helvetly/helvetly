import { describe, expect, it } from 'vitest'

import { formatAmount, formatDate, formatRelative, setDisplayTimeZone } from './format'

test('civil dates keep their calendar day in every browser time zone', () => {
  expect(formatDate('2026-11-07')).toBe('7 Nov 2026')
  expect(formatDate('2027-01-01')).toBe('1 Jan 2027')
})

test('a timestamp shows its day in the display zone; a civil date stays as it is', () => {
  try {
    setDisplayTimeZone('Europe/Zurich')
    expect(formatDate('2026-03-28T23:30:00Z')).toBe('29 Mar 2026')
    setDisplayTimeZone('Pacific/Pago_Pago')
    expect(formatDate('2026-11-16T10:00:00Z')).toBe('15 Nov 2026')
    expect(formatDate('2026-11-16')).toBe('16 Nov 2026')
  } finally {
    setDisplayTimeZone(undefined)
  }
})

describe('formatRelative', () => {
  const now = Date.parse('2026-11-06T12:00:00Z')
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

  it.each([
    [10, 'just now'],
    [5 * 60, '5 minutes ago'],
    [3 * 3600, '3 hours ago'],
    [86_400, 'yesterday'],
    [2 * 86_400, '2 days ago'],
    [14 * 86_400, '2 weeks ago'],
    [400 * 86_400, 'last year'],
  ])('%i seconds ago reads "%s"', (seconds, text) => {
    expect(formatRelative(ago(seconds), now)).toBe(text)
  })
})

test('amounts group thousands, and zero never carries a minus', () => {
  expect(formatAmount('12500.5')).toBe('12’500.50')
  expect(formatAmount('9007199254740993.1234')).toBe('9’007’199’254’740’993.1234')
  expect(formatAmount('-310.00')).toBe('−310.00')
  expect(formatAmount('-0.00')).toBe('0.00')
  expect(formatAmount('-0')).toBe('0.00')
})
