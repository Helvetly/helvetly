import { beforeEach, describe, expect, it, vi } from 'vitest'

import { request } from '@/lib/api'

import {
  DEFAULT_SETTINGS,
  durationMinutes,
  parseLeadTime,
  policySentence,
  presetText,
  schedulingApi,
  splitDuration,
  windowProblem,
} from './scheduling-settings'

describe('presetText', () => {
  it.each([
    [0, 'No minimum'],
    [30, '30 minutes'],
    [60, '1 hour'],
    [1440, '24 hours'],
    [2880, '48 hours'],
    [4320, '3 days'],
    [10080, '1 week'],
    [90, '1 hour 30 minutes'],
  ])('%j → %j', (minutes, text) => expect(presetText(minutes)).toBe(text))
})

describe('splitDuration and durationMinutes', () => {
  it.each([
    [2880, ['hours', 'days'], 2, 'days'],
    [1500, ['hours', 'days'], 25, 'hours'],
    [90, ['minutes', 'hours'], 90, 'minutes'],
    [120, ['minutes', 'hours'], 2, 'hours'],
    [30, ['hours', 'days'], 0.5, 'hours'],
  ] as const)('%j in %j → %j %s and back', (minutes, units, amount, unit) => {
    expect(splitDuration(minutes, units)).toEqual({ amount, unit })
    expect(durationMinutes(String(amount), unit)).toBe(minutes)
  })
  it('reads a comma and refuses nothing typed', () => {
    expect(durationMinutes('1,5', 'hours')).toBe(90)
    expect(durationMinutes(' ', 'hours')).toBeNaN()
    expect(durationMinutes('soon', 'days')).toBeNaN()
  })
})

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

vi.mock('@/lib/api', () => ({ request: vi.fn<typeof request>() }))

describe('scheduling settings request bodies', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
  })

  it('does not write the policy text returned with settings', async () => {
    const saved = { ...DEFAULT_SETTINGS, policy_text: 'Free until 24 hours before.' }
    vi.mocked(request).mockResolvedValue({ data: saved })

    await schedulingApi.saveSettings(await schedulingApi.settings())

    expect(request).toHaveBeenLastCalledWith('/scheduling/settings', {
      method: 'PUT',
      json: DEFAULT_SETTINGS,
    })
  })

  it('puts the host ID in the route and sends only writable hours', async () => {
    const hours = {
      time_zone: null,
      bookable: true,
      color: null,
      weekly: [{ day: 1, start: '09:00', end: '17:00' }],
      overrides: [],
    }
    vi.mocked(request).mockResolvedValue({ data: { user_id: 'usr_1', ...hours } })

    await schedulingApi.saveHours({ ...(await schedulingApi.hours('usr_1')), userId: 'usr_1' })

    expect(request).toHaveBeenLastCalledWith('/scheduling/hosts/usr_1', {
      method: 'PUT',
      json: hours,
    })
  })
})
