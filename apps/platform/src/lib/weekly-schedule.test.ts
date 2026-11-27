import { describe, expect, it } from 'vitest'

import {
  clockOptions,
  copyDay,
  defaultWeek,
  nextRange,
  rangeProblems,
  rangesOf,
  setRanges,
} from './weekly-schedule'

const clocks = (ranges: readonly { start: string; end: string }[]) =>
  ranges.map(({ start, end }) => ({ start, end }))

describe('weekly schedule', () => {
  it('starts new hosts on Monday to Friday, 09:00–17:00', () => {
    const week = defaultWeek()
    expect(week.map((one) => one.day)).toEqual([1, 2, 3, 4, 5])
    expect(clocks(rangesOf(week, 3))).toEqual([{ start: '09:00', end: '17:00' }])
    expect(rangesOf(week, 6)).toEqual([])
  })

  it('replaces one day and keeps the week in weekday order', () => {
    const week = setRanges([{ day: 5, start: '08:00', end: '12:00' }], 2, [
      { start: '13:00', end: '14:00' },
      { start: '09:00', end: '10:00' },
    ])
    expect(week).toEqual([
      { day: 2, start: '13:00', end: '14:00' },
      { day: 2, start: '09:00', end: '10:00' },
      { day: 5, start: '08:00', end: '12:00' },
    ])
    expect(setRanges(week, 2, [])).toEqual([{ day: 5, start: '08:00', end: '12:00' }])
    // The week's own entries are kept as they are, so the editor can follow them.
    expect(rangesOf(setRanges(week, 5, rangesOf(week, 5)), 5)[0]).toBe(week[2])
  })

  it.each([
    ['empty day', [], { start: '09:00', end: '17:00' }],
    ['after the latest end', [{ start: '09:00', end: '12:00' }], { start: '13:00', end: '14:00' }],
    ['late in the day', [{ start: '09:00', end: '22:30' }], { start: '22:59', end: '23:59' }],
    ['full day', [{ start: '00:00', end: '23:59' }], null],
  ])('suggests the next range: %s', (_, ranges, next) => {
    expect(nextRange(ranges)).toEqual(next)
  })

  it('copies a day onto others, replacing their hours, never itself', () => {
    const week = [
      { day: 1, start: '08:00', end: '12:00' },
      { day: 1, start: '13:00', end: '17:00' },
      { day: 3, start: '10:00', end: '11:00' },
    ]
    const copied = copyDay(week, 1, [1, 2, 3, 4, 5])
    for (const day of [1, 2, 3, 4, 5])
      expect(clocks(rangesOf(copied, day))).toEqual([
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ])
    expect(rangesOf(copied, 6)).toEqual([])
    // An empty day copied clears the targets.
    expect(copyDay(copied, 7, [2])).not.toContainEqual(expect.objectContaining({ day: 2 }))
  })

  it('names each broken range: order first, then overlaps', () => {
    expect(rangeProblems([{ start: '09:00', end: '17:00' }])).toEqual(new Map())
    const problems = rangeProblems([
      { start: '09:00', end: '12:00' },
      { start: '11:00', end: '13:00' },
      { start: '15:00', end: '14:00' },
      { start: '12:00', end: '12:30' },
    ])
    expect(Object.fromEntries(problems)).toEqual({
      0: 'overlap',
      1: 'overlap',
      2: 'order',
      3: 'overlap',
    })
    // Touching ranges are fine.
    expect(
      rangeProblems([
        { start: '09:00', end: '12:00' },
        { start: '12:00', end: '13:00' },
      ]).size,
    ).toBe(0)
  })

  it('offers quarter hours, the end of the day and an off-grid saved time', () => {
    const options = clockOptions('10:10')
    expect(options[0]).toBe('00:00')
    expect(options).toContain('10:10')
    expect(options.at(-1)).toBe('23:59')
    expect(options.indexOf('10:10')).toBe(options.indexOf('10:00') + 1)
    expect(clockOptions('10:15')).toHaveLength(97)
  })
})
