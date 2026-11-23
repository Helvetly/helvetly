import { describe, expect, it } from 'vitest'

import { dayOffHint, withDaysOff } from './day-off'

describe('withDaysOff', () => {
  it('adds days off without sessions and keeps the days in date order', () => {
    const groups = new Map([
      ['2026-12-24', ['a']],
      ['2026-12-28', ['b']],
    ])
    const daysOff = new Map([
      ['2026-12-25', 'Christmas Day'],
      ['2026-12-24', 'Christmas Eve'],
    ])
    expect(withDaysOff(groups, daysOff)).toEqual([
      ['2026-12-24', ['a']],
      ['2026-12-25', []],
      ['2026-12-28', ['b']],
    ])
  })

  it('leaves the groups alone without days off', () => {
    expect(withDaysOff(new Map([['2026-12-24', ['a']]]), undefined)).toEqual([
      ['2026-12-24', ['a']],
    ])
  })
})

it('dayOffHint names the day', () => {
  expect(dayOffHint('Christmas Day')).toBe('Day off: no bookings (Christmas Day)')
})
