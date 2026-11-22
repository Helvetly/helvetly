import { describe, expect, it } from 'vitest'

import { event, occurrence } from '@/mocks/scheduling'

import {
  blankValues,
  changesOf,
  setPosOf,
  slotOf,
  toInput,
  validate,
  valuesFrom,
} from './session-model'

const ZONE = 'Europe/Zurich'
const blank = (change = {}) => ({
  ...blankValues({ date: '2026-12-01', minutes: 540, hostId: 'usr_story', location: 'Office' }),
  client: { id: 'cli_01', name: 'Alpenglow' },
  title: 'Coaching',
  ...change,
})

describe('validate', () => {
  it('accepts a complete one-off session', () => {
    expect(validate(blank())).toEqual({})
  })

  it.each([
    ['client', { client: null }],
    ['title', { title: '  ' }],
    ['host_id', { host_id: '' }],
    ['duration', { duration: '4' }],
    ['duration', { duration: '721' }],
    ['time', { time: '9' }],
    ['by_day', { repeat: 'weekly', by_day: [] }],
    ['interval', { repeat: 'weekly', interval: '13' }],
    ['until', { repeat: 'weekly', ends: 'until', until: '2026-11-30' }],
    ['count', { repeat: 'monthly', ends: 'count', count: '521' }],
    ['meeting_url', { mode: 'online', provider: 'manual', meeting_url: 'http://plain' }],
  ])('flags %s', (field, change) => {
    expect(Object.keys(validate(blank(change)))).toEqual([field])
  })

  it('ignores the rule fields of a one-off session', () => {
    expect(validate(blank({ by_day: [], count: 'x' }))).toEqual({})
  })
})

describe('toInput', () => {
  it('writes the slot as wall clock in the zone, live with its place', () => {
    expect(toInput(blank(), ZONE)).toMatchObject({
      client_id: 'cli_01',
      engagement_id: null,
      host_id: 'usr_story',
      starts_local: '2026-12-01T09:00',
      time_zone: ZONE,
      duration_minutes: 60,
      mode: 'live',
      location: 'Office',
      meeting: null,
      recurrence: null,
      notify: true,
    })
  })

  it('makes the rules the drawer offers', () => {
    expect(
      toInput(
        blank({
          repeat: 'weekly',
          interval: '2',
          by_day: ['TU', 'TH'],
          ends: 'count',
          count: '18',
        }),
        ZONE,
      ).recurrence,
    ).toEqual({
      freq: 'weekly',
      interval: 2,
      by_day: ['TU', 'TH'],
      count: 18,
    })
    expect(
      toInput(blank({ repeat: 'monthly', ends: 'until', until: '2027-06-30' }), ZONE).recurrence,
    ).toEqual({
      freq: 'monthly',
      interval: 1,
      by_month_day: 1,
      until: '2027-06-30',
    })
    expect(
      toInput(blank({ date: '2026-12-29', repeat: 'monthly', monthly: 'weekday' }), ZONE)
        .recurrence,
    ).toEqual({
      freq: 'monthly',
      interval: 1,
      by_set_pos: { pos: -1, day: 'TU' },
    })
  })

  it('sends an online session’s own link only for a manual meeting', () => {
    expect(
      toInput(
        blank({ mode: 'online', provider: 'manual', meeting_url: 'https://meet.example/x' }),
        ZONE,
      ),
    ).toMatchObject({
      meeting: { provider: 'manual', url: 'https://meet.example/x' },
      location: null,
    })
    expect(
      toInput(blank({ mode: 'online', provider: 'google_meet', meeting_url: 'https://old' }), ZONE)
        .meeting,
    ).toEqual({
      provider: 'google_meet',
      url: null,
    })
  })
})

describe('setPosOf', () => {
  it.each([
    ['2026-12-01', 1],
    ['2026-12-08', 2],
    ['2026-12-22', 4],
    ['2026-12-29', -1],
    ['2026-12-25', -1],
  ])('%s is the %d weekday of its month', (date, pos) => {
    expect(setPosOf(date)).toBe(pos)
  })
})

describe('editing', () => {
  const series = event({
    recurrence: { freq: 'weekly', interval: 1, by_day: ['WE'] },
    starts_local: '2026-12-02T10:00',
  })
  const session = occurrence()

  it('opens the form on the session’s own time in the event’s zone', () => {
    expect(valuesFrom(session, series)).toMatchObject({
      date: '2026-12-02',
      time: '10:00',
      duration: '60',
      repeat: 'weekly',
      by_day: ['WE'],
      client: session.client,
    })
  })

  it('sends only what changed, and says when the rule changed', () => {
    const before = valuesFrom(session, series)
    expect(changesOf(before, before, ZONE)).toEqual({
      body: { notify: true },
      ruleChanged: false,
      empty: true,
    })
    expect(changesOf(before, { ...before, time: '11:00', notify: false }, ZONE)).toEqual({
      body: { starts_local: '2026-12-02T11:00', notify: false },
      ruleChanged: false,
      empty: false,
    })
    expect(changesOf(before, { ...before, by_day: ['WE', 'FR'] }, ZONE).ruleChanged).toBe(true)
  })

  it('gives the conflict check the slot once it is complete', () => {
    expect(slotOf(blank(), ZONE)).toEqual({
      starts_at: '2026-12-01T08:00:00.000Z',
      ends_at: '2026-12-01T09:00:00.000Z',
    })
    expect(slotOf(blank({ time: '' }), ZONE)).toBeNull()
  })
})
