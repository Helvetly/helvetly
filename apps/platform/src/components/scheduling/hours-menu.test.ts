import { afterEach, describe, expect, it } from 'vitest'

import { HOURS_KEY, storedHours, workingHours } from './hours-menu'

const profile = (weekly: { day: number; start: string; end: string }[]) => ({
  time_zone: 'Europe/Zurich',
  bookable: true,
  color: null,
  weekly,
  overrides: [],
})

describe('workingHours', () => {
  it.each([
    ['no profile', undefined, { from: 6, to: 22 }],
    ['no weekly hours', profile([]), { from: 6, to: 22 }],
    [
      'the widest day, rounded out to whole hours',
      profile([
        { day: 1, start: '08:30', end: '17:00' },
        { day: 2, start: '09:00', end: '18:15' },
      ]),
      { from: 8, to: 19 },
    ],
  ])('%s', (_, given, expected) => {
    expect(workingHours(given)).toEqual(expected)
  })
})

describe('storedHours', () => {
  afterEach(() => localStorage.removeItem(HOURS_KEY))

  it.each([
    ['nothing saved', null, null],
    ['not JSON', '{', null],
    ['an unknown mode', '{"mode":"x","work":{"from":6,"to":22}}', null],
    ['an end before the start', '{"mode":"work","work":{"from":9,"to":8}}', null],
    ['an hour past 24', '{"mode":"work","work":{"from":6,"to":25}}', null],
    ['half hours', '{"mode":"work","work":{"from":6.5,"to":22}}', null],
    [
      'a valid range',
      '{"mode":"work","work":{"from":6,"to":22}}',
      { mode: 'work', work: { from: 6, to: 22 } },
    ],
  ])('%s', (_, saved, expected) => {
    if (saved !== null) localStorage.setItem(HOURS_KEY, saved)
    expect(storedHours()).toEqual(expected)
  })
})
