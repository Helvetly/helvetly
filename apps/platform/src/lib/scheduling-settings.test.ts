import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  parseLeadTime,
  policySentence,
  windowProblem,
} from './scheduling-settings'

describe('parseLeadTime', () => {
  it.each([
    ['90', 90],
    ['90m', 90],
    ['2h', 120],
    ['1d', 1440],
    [' 1 D ', 1440],
    ['0', null],
    ['soon', null],
    ['', null],
  ])('%j → %j', (text, minutes) => expect(parseLeadTime(text)).toBe(minutes))
})

describe('windowProblem', () => {
  it('accepts ordered, separate blocks', () =>
    expect(
      windowProblem([
        { day: 1, start: '08:00', end: '12:00' },
        { day: 1, start: '13:00', end: '17:00' },
      ]),
    ).toBeNull())
  it('refuses a block that ends before it starts', () =>
    expect(windowProblem([{ day: 1, start: '12:00', end: '08:00' }])).toBe(
      'Each block must end after it starts.',
    ))
  it('refuses overlapping blocks on one day only', () => {
    const a = { day: 1, start: '08:00', end: '12:00' }
    expect(windowProblem([a, { day: 1, start: '11:00', end: '14:00' }])).toBe(
      'Blocks on one day can’t overlap.',
    )
    expect(windowProblem([a, { day: 2, start: '11:00', end: '14:00' }])).toBeNull()
  })
})

describe('policySentence', () => {
  it('says any time when nothing is required', () =>
    expect(policySentence({ ...DEFAULT_SETTINGS, notice_minutes: 0, cutoff_time: null })).toContain(
      'at any time',
    ))
  it('states the free window and what a late cancellation does', () => {
    const free = policySentence({
      ...DEFAULT_SETTINGS,
      notice_minutes: 1440,
      late_cancel_counts: false,
    })
    expect(free).toContain('1 day')
    expect(free).toContain('still free')
    expect(policySentence({ ...DEFAULT_SETTINGS, late_cancel_counts: true })).toContain(
      'counts as used',
    )
  })
})
