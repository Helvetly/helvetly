import { ApiError, setCsrfToken } from '@helvetly/ui/lib/http'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { portalHandlers, portalSession } from '@/mocks/portal'
import {
  bookingInfo,
  germanSeries,
  germanUpcoming,
  oneOffSessions,
  request as sessionRequest,
  schedulingHandlers,
  upcomingSessions,
} from '@/mocks/scheduling'

import {
  book,
  cancelRuleText,
  civilDay,
  deadlineText,
  formatClock,
  getBooking,
  groupSessions,
  isLateNow,
  isOpen,
  isSlotTaken,
  lateCounts,
  listSessions,
  requestCancel,
  relativeDay,
  requestReschedule,
  ruleText,
  seriesIcsUrl,
  sessionAttention,
  sessionIcsUrl,
  slotsByDay,
  uniqueStarts,
  weekRange,
  zoneName,
  type ClientSession,
} from './scheduling'

const S = '/api/v1/public/portal/scheduling'
const server = setupServer(...schedulingHandlers, ...portalHandlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const session = (fields: Partial<ClientSession>): ClientSession => ({
  ...oneOffSessions[1]!,
  ...fields,
})

describe('portal scheduling client', () => {
  it('lists sessions by when', async () => {
    expect(await listSessions('upcoming')).toEqual(upcomingSessions)
    expect((await listSessions('past')).every((s) => !isOpen(s))).toBe(true)
  })

  it('treats a plan without Scheduling as no booking', async () => {
    expect(await getBooking()).toEqual(bookingInfo)
    server.use(
      http.get(`${S}/booking`, () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 }),
      ),
    )
    expect(await getBooking()).toBeNull()
  })

  it('sends a trimmed note and only what was given', async () => {
    setCsrfToken(portalSession.csrf_token)
    const bodies: unknown[] = []
    server.use(
      http.post(`${S}/occurrences/:id/:kind`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: {} }, { status: 201 })
      }),
    )
    await requestCancel('soc_1', '   ')
    await requestCancel('soc_1', ' Sick ')
    await requestReschedule('soc_1', ['2026-12-01T09:00:00.000Z'], '')
    expect(bodies).toEqual([{}, { note: 'Sick' }, { proposed_times: ['2026-12-01T09:00:00.000Z'] }])
  })

  it('names a taken slot', async () => {
    server.use(
      http.post(`${S}/booking`, () =>
        HttpResponse.json({ error: { code: 'slot_taken', message: 'Taken.' } }, { status: 409 }),
      ),
    )
    const failure = await book({ event_type_id: 'set_trial', starts_at: 'x' }).catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(ApiError)
    expect(isSlotTaken(failure)).toBe(true)
    expect(isSlotTaken(new Error('x'))).toBe(false)
  })

  it('builds the ics url', () => {
    expect(sessionIcsUrl('soc/1')).toBe(`${S}/occurrences/soc%2F1/ics`)
  })
})

describe('session helpers', () => {
  const now = new Date('2026-11-30T10:00:00Z')

  it('says whether cancelling now is late', () => {
    expect(isLateNow(session({ deadline: '2026-11-30T09:59:00Z' }), now)).toBe(true)
    expect(isLateNow(session({ deadline: '2026-11-30T10:00:00Z' }), now)).toBe(false)
    expect(isLateNow(session({ deadline: null }), now)).toBe(false)
  })

  it('words the deadline in the session zone', () => {
    const s = session({ deadline: '2026-12-04T13:00:00Z', time_zone: 'Europe/Zurich' })
    expect(deadlineText(s, now)).toMatch(/^Free cancellation until .*14:00$/)
    expect(deadlineText(s, new Date('2026-12-05T00:00:00Z'))).toBe(
      'The free cancellation period has ended',
    )
    expect(deadlineText(session({ deadline: null }), now)).toBe('')
  })

  it('formats clocks and days in a zone across DST', () => {
    expect(formatClock('2026-07-01T07:00:00Z', 'Europe/Zurich')).toBe('09:00')
    expect(formatClock('2026-12-01T08:00:00Z', 'Europe/Zurich')).toBe('09:00')
    expect(civilDay('2026-12-01T23:30:00Z', 'Europe/Zurich')).toBe('2026-12-02')
    expect(civilDay('2026-12-01T23:30:00Z', 'America/New_York')).toBe('2026-12-01')
  })

  it('names zones by their city', () => {
    expect(zoneName('Europe/Zurich')).toBe('Zurich')
    expect(zoneName('America/New_York')).toBe('New York')
    expect(zoneName('UTC')).toBe('UTC')
  })

  it('tells which late requests count', () => {
    const s = session({ late_cancel_counts: true, late_reschedule_counts: false })
    expect(lateCounts(s, 'cancel')).toBe(true)
    expect(lateCounts(s, 'reschedule')).toBe(false)
  })

  it('groups slots by day in order and keeps one per start', () => {
    const slots = [
      { starts_at: '2026-12-02T08:00:00Z', host_id: 'b' },
      { starts_at: '2026-12-01T09:00:00Z', host_id: 'a' },
      { starts_at: '2026-12-01T08:00:00Z', host_id: 'a' },
      { starts_at: '2026-12-01T08:00:00Z', host_id: 'b' },
    ]
    const days = slotsByDay(uniqueStarts(slots), 'UTC')
    expect(days.map((d) => d.day)).toEqual(['2026-12-01', '2026-12-02'])
    expect(days[0]!.slots.map((s) => s.starts_at)).toEqual([
      '2026-12-01T08:00:00Z',
      '2026-12-01T09:00:00Z',
    ])
  })

  it('pages weeks from the start of today', () => {
    const base = new Date(2026, 10, 30, 15, 30)
    const { from, to } = weekRange(1, base)
    expect(from).toEqual(new Date(2026, 11, 7))
    expect(to).toEqual(new Date(2026, 11, 14))
  })
})

describe('series', () => {
  it('collapses a series into one group where its first session is', () => {
    const groups = groupSessions(upcomingSessions)
    const series = groups.filter((g) => g.kind === 'series')
    expect(series).toHaveLength(1)
    expect(series[0]!.kind === 'series' && series[0]!.sessions).toHaveLength(53)
    expect(groups).toHaveLength(oneOffSessions.length + 1)
    expect(groups[0]).toEqual({ kind: 'one', session: oneOffSessions[0] })
    expect(groups[1]!.kind).toBe('series')
  })

  it('says the rule, the cancellation and the day in words', () => {
    const tuesday = {
      ...germanUpcoming[0]!,
      starts_at: '2026-11-24T19:30:00Z',
      ends_at: '2026-11-24T22:00:00Z',
      deadline: '2026-11-23T19:30:00Z',
    }
    const rule = { ...germanSeries.recurrence!, by_day: ['TU'] }
    expect(ruleText({ ...germanSeries, recurrence: rule }, tuesday)).toBe(
      'Every Tuesday, 20:30–23:00',
    )
    expect(
      ruleText(
        { ...germanSeries, recurrence: { ...rule, by_day: ['TH', 'TU'], interval: 2 } },
        tuesday,
      ),
    ).toBe('Every 2 weeks on Tuesday and Thursday, 20:30–23:00')
    expect(ruleText({ ...germanSeries, recurrence: { ...rule, by_day: [] } }, tuesday)).toMatch(
      /^Every Tuesday/,
    )
    expect(ruleText({ ...germanSeries, recurrence: { ...rule, freq: 'monthly' } }, tuesday)).toBe(
      'Every month, 20:30–23:00',
    )
    expect(cancelRuleText(tuesday)).toBe('Free cancellation up to 24 hours before each session')
    expect(cancelRuleText({ ...tuesday, deadline: null })).toBe('')
    const now = new Date('2026-11-23T10:00:00Z')
    expect(relativeDay('2026-11-23T20:00:00Z', 'Europe/Zurich', now)).toBe('Today')
    expect(relativeDay('2026-11-24T19:30:00Z', 'Europe/Zurich', now)).toBe('Tomorrow')
    expect(relativeDay('2026-11-26T19:30:00Z', 'Europe/Zurich', now)).toBe('Thu, 26 Nov 2026')
    expect(seriesIcsUrl('sev_1')).toBe(`${S}/series/sev_1/ics`)
  })

  it('lists sessions waiting for the client once each', () => {
    const now = new Date('2026-11-23T10:00:00Z')
    const h = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString()
    const at = (id: string, start: number, over: Partial<ClientSession> = {}) =>
      session({ id, starts_at: h(start), ends_at: h(start + 1), deadline: h(start - 24), ...over })
    const next = at('next', 30)
    const closing = at('closing', 40)
    const proposed = at('proposed', 200, {
      request: sessionRequest({ id: 'r', kind: 'reschedule', status: 'proposed' }),
    })
    const cancelled = at('gone', 2, { status: 'cancelled_on_time' })
    const far = at('far', 300)
    expect(
      sessionAttention([cancelled, next, closing, proposed, far], now).map((a) => [
        a.session.id,
        a.reason,
      ]),
    ).toEqual([
      ['next', 'deadline'],
      ['closing', 'deadline'],
      ['proposed', 'proposal'],
    ])
    expect(sessionAttention([at('soon', 100), far], now).map((a) => a.reason)).toEqual(['next'])
    expect(sessionAttention([at('later', 200)], now)).toEqual([])
  })
})
