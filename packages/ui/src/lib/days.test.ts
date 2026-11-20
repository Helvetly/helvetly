import { describe, expect, it } from 'vitest'

import { byDay, formatDay } from './days'

describe('byDay', () => {
  it.each([
    { dates: [], want: [] },
    { dates: ['2026-11-20'], want: [['2026-11-20', 1]] },
    {
      dates: ['2026-11-20', '2026-11-20', '2026-11-18', '2026-11-04'],
      want: [
        ['2026-11-20', 2],
        ['2026-11-18', 1],
        ['2026-11-04', 1],
      ],
    },
  ])('groups $dates', ({ dates, want }) => {
    const got = byDay(dates.map((date, i) => ({ date, i })))
    expect(got.map((day) => [day.date, day.items.length])).toEqual(want)
    expect(got.flatMap((day) => day.items.map((item) => item.i))).toEqual(dates.map((_, i) => i))
  })
})

describe('formatDay', () => {
  it('names the weekday of the civil date, whatever the time zone', () => {
    expect(formatDay('2026-11-20')).toBe('Fri 20 Nov')
  })
})
