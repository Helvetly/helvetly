import { describe, expect, it } from 'vitest'

import { occurrence } from '@/mocks/scheduling'

import {
  addDays,
  daysOf,
  defaultCancelAs,
  defaultUnits,
  expandDates,
  instantOf,
  localOf,
  needsMarking,
  occurrencesCsv,
  periodLabel,
  rangeOf,
  recurrenceSummary,
  step,
  weekStart,
  zoned,
  type Recurrence,
} from './scheduling'

describe('zones', () => {
  it.each([
    // date, wall clock, zone, instant
    ['2026-12-01', '09:00', 'Europe/Zurich', '2026-12-01T08:00:00.000Z'],
    ['2026-07-01', '09:00', 'Europe/Zurich', '2026-07-01T07:00:00.000Z'],
    ['2026-07-01', '09:00', 'America/New_York', '2026-07-01T13:00:00.000Z'],
    // Spring gap: 02:30 does not exist and moves forward by the gap (03:30 CEST).
    ['2026-03-29', '02:30', 'Europe/Zurich', '2026-03-29T01:30:00.000Z'],
    ['2026-03-08', '02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
    // Autumn overlap: 02:30 happens twice; the first (summer-time) one wins.
    ['2026-10-25', '02:30', 'Europe/Zurich', '2026-10-25T00:30:00.000Z'],
    ['2026-11-01', '01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    ['2026-10-25', '09:00', 'Europe/Zurich', '2026-10-25T08:00:00.000Z'],
  ])('%s %s in %s is %s', (date, time, zone, instant) => {
    const [h, m] = time.split(':').map(Number)
    expect(instantOf(date, (h ?? 0) * 60 + (m ?? 0), zone).toISOString()).toBe(instant)
  })

  it('reads the wall clock back', () => {
    expect(zoned('2026-12-01T08:00:00Z', 'Europe/Zurich')).toEqual({
      date: '2026-12-01',
      minutes: 540,
    })
    expect(zoned('2026-12-01T23:30:00Z', 'Europe/Zurich')).toEqual({
      date: '2026-12-02',
      minutes: 30,
    })
    expect(localOf('2026-07-01T07:00:00Z', 'Europe/Zurich')).toBe('2026-07-01T09:00')
  })
})

describe('views', () => {
  it('starts weeks on Monday and steps by the view', () => {
    expect(weekStart('2026-12-02')).toBe('2026-11-30')
    expect(weekStart('2026-11-30')).toBe('2026-11-30')
    expect(weekStart('2026-12-06')).toBe('2026-11-30')
    expect(step('day', '2026-12-31', 1)).toBe('2027-01-01')
    expect(step('week', '2026-12-02', -1)).toBe('2026-11-25')
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(step('list', '2026-12-02', 1)).toBe(addDays('2026-12-02', 30))
  })

  it('shows whole weeks around a month', () => {
    const days = daysOf('month', '2026-12-15')
    expect(days[0]).toBe('2026-11-30')
    expect(days.at(-1)).toBe('2027-01-03')
    expect(days).toHaveLength(35)
    expect(daysOf('week', '2026-12-02')).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ])
  })

  it('asks for the view’s days from midnight to midnight in the zone, a DST week included', () => {
    expect(rangeOf('day', '2026-12-02', 'Europe/Zurich')).toEqual({
      from: '2026-12-01T23:00:00.000Z',
      to: '2026-12-02T23:00:00.000Z',
    })
    // The week of the autumn switch: it starts in summer time and ends in winter time.
    expect(rangeOf('week', '2026-10-25', 'Europe/Zurich')).toEqual({
      from: '2026-10-18T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
    })
  })

  it('names the period', () => {
    expect(periodLabel('month', '2026-12-15')).toBe('December 2026')
    expect(periodLabel('week', '2026-12-02')).toBe('30 Nov 2026 – 6 Dec 2026')
  })
})

const weekly = (change: Partial<Recurrence> = {}): Recurrence => ({
  freq: 'weekly',
  interval: 1,
  ...change,
})

describe('expandDates', () => {
  it.each<[string, Recurrence, string, string[]]>([
    [
      'weekly on the first date’s weekday',
      weekly({ count: 3 }),
      '2026-12-01',
      ['2026-12-01', '2026-12-08', '2026-12-15'],
    ],
    [
      'twice a week, every second week',
      weekly({ interval: 2, by_day: ['FR', 'TU'], count: 4 }),
      '2026-12-01',
      ['2026-12-01', '2026-12-04', '2026-12-15', '2026-12-18'],
    ],
    [
      'until is inclusive',
      weekly({ until: '2026-12-15' }),
      '2026-12-01',
      ['2026-12-01', '2026-12-08', '2026-12-15'],
    ],
    [
      'the 31st skips shorter months',
      { freq: 'monthly', interval: 1, by_month_day: 31, count: 3 },
      '2026-12-31',
      ['2026-12-31', '2027-01-31', '2027-03-31'],
    ],
    [
      'the last day of each month',
      { freq: 'monthly', interval: 1, by_month_day: -1, count: 3 },
      '2027-01-31',
      ['2027-01-31', '2027-02-28', '2027-03-31'],
    ],
    [
      'the last Friday',
      { freq: 'monthly', interval: 1, by_set_pos: { pos: -1, day: 'FR' }, count: 3 },
      '2026-12-25',
      ['2026-12-25', '2027-01-29', '2027-02-26'],
    ],
    [
      'the 2nd Tuesday every 2 months',
      { freq: 'monthly', interval: 2, by_set_pos: { pos: 2, day: 'TU' }, count: 2 },
      '2026-12-08',
      ['2026-12-08', '2027-02-09'],
    ],
  ])('%s', (_, rule, start, dates) => {
    expect(expandDates(rule, start)).toEqual(dates)
  })

  it('stops at 520 sessions', () => {
    expect(expandDates(weekly(), '2026-12-01')).toHaveLength(520)
  })
})

describe('recurrenceSummary', () => {
  it.each<[Recurrence, string, string]>([
    [{ freq: 'weekly', interval: 1 }, '2026-12-01', 'Every week on Tue'],
    [
      { freq: 'weekly', interval: 2, by_day: ['TH', 'TU'], until: '2027-06-30' },
      '2026-12-01',
      'Every 2 weeks on Tue and Thu until 30 Jun 2027, 31 sessions',
    ],
    [
      { freq: 'weekly', interval: 1, by_day: ['MO'], count: 10 },
      '2026-11-30',
      'Every week on Mon, 10 sessions',
    ],
    [{ freq: 'monthly', interval: 1, by_month_day: 14 }, '2026-12-14', 'Every month on day 14'],
    [
      { freq: 'monthly', interval: 3, by_month_day: -1 },
      '2026-12-31',
      'Every 3 months on the last day',
    ],
    [
      { freq: 'monthly', interval: 1, by_set_pos: { pos: 2, day: 'TU' } },
      '2026-12-08',
      'Every month on the second Tuesday',
    ],
  ])('%j from %s', (rule, start, text) => {
    expect(recurrenceSummary(rule, start)).toBe(text)
  })
})

describe('defaults', () => {
  it.each([
    ['hour', 90, '1.5'],
    ['hour', 50, '0.833'],
    ['day', 240, '0.5'],
    ['piece', 90, '1'],
    [null, 90, '1'],
  ])('a %s engagement uses %s for %d minutes', (unit, minutes, units) => {
    expect(defaultUnits(unit, Number(minutes))).toBe(units)
  })

  it('suggests a late cancellation once the notice has run out', () => {
    const session = { starts_at: '2026-12-03T09:00:00Z' }
    expect(
      defaultCancelAs(session, { notice_minutes: 1440 }, Date.parse('2026-12-02T08:59:00Z')),
    ).toBe('on_time')
    expect(
      defaultCancelAs(session, { notice_minutes: 1440 }, Date.parse('2026-12-02T09:01:00Z')),
    ).toBe('late')
    expect(defaultCancelAs(session, undefined, Date.parse('2026-12-01T09:00:00Z'))).toBe('on_time')
  })

  it('lists past open sessions to mark', () => {
    const now = Date.parse('2026-12-02T12:00:00Z')
    expect(needsMarking(occurrence({ starts_at: '2026-12-02T09:00:00Z' }), now)).toBe(true)
    expect(needsMarking(occurrence({ starts_at: '2026-12-02T11:30:00Z' }), now)).toBe(false)
    expect(
      needsMarking(occurrence({ starts_at: '2026-12-02T09:00:00Z', status: 'attended' }), now),
    ).toBe(false)
  })
})

describe('occurrencesCsv', () => {
  it('writes one row per session in the zone, quoting what needs it', () => {
    const csv = occurrencesCsv(
      [occurrence({ starts_at: '2026-12-02T09:00:00Z', title: 'Review, part 1' })],
      'Europe/Zurich',
    )
    expect(csv.split('\n')).toEqual([
      'Date,Start,End,Title,Client,Host,Status,Engagement',
      '2026-12-02,10:00,11:00,"Review, part 1",Alpenglow Studio GmbH,Anna Muster,Scheduled,',
    ])
  })
})
