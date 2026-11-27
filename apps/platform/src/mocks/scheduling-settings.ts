// The scheduling settings, holidays, event types, host hours, calendar connections and iCal feed as the contract
// describes them: a test-only fake (Vitest and Storybook); Go serves the real routes.
import { http, HttpResponse } from 'msw'

import {
  DEFAULT_SETTINGS,
  type Connection,
  type Connections,
  type EventType,
  type EventTypeInput,
  type Feed,
  type Holiday,
  type HostHours,
  type Provider,
  type SchedulingSettings,
} from '@/lib/scheduling-settings'

const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  HttpResponse.json(
    { error: { code, message, ...(fields ? { details: { fields } } : {}) } },
    { status },
  )

export const sampleEventType: EventType = {
  id: 'set_intro',
  name: 'Intro call',
  description: 'A first conversation.',
  duration_minutes: 30,
  mode: 'online',
  meeting_provider: 'manual',
  location: null,
  product_id: null,
  unit_price: null,
  currency: null,
  host_ids: [],
  buffer_before: 0,
  buffer_after: 10,
  min_notice_minutes: 720,
  max_horizon_days: 60,
  slot_step_minutes: null,
  bookable: true,
  color: null,
  archived_at: null,
}

export const googleConnection: Connection = {
  id: 'cal_google',
  provider: 'google',
  account_email: 'anna@muster.ch',
  status: 'active',
  push_calendar_id: 'primary',
  busy_calendar_ids: ['primary'],
  calendars: [
    { id: 'primary', name: 'anna@muster.ch', primary: true, color: '#4285f4' },
    { id: 'team', name: 'Team', primary: false, color: '#33b679' },
    {
      id: 'holidays',
      name: 'Feiertage in der Schweiz und Ferien der Kantone Zürich, Bern und Luzern',
      primary: false,
      color: '#f6bf26',
    },
    { id: 'shared', name: 'Shared with me', primary: false, color: null },
  ],
  // Read when answered, so "Synced 2 minutes ago" reads the same in every run.
  get last_synced_at() {
    return new Date(Date.now() - 2 * 60_000).toISOString()
  },
  error: null,
}

export const sampleHours: HostHours = {
  saved: true,
  time_zone: 'Europe/Zurich',
  bookable: true,
  color: null,
  weekly: [
    { day: 1, start: '09:00', end: '12:00' },
    { day: 1, start: '13:00', end: '17:00' },
    { day: 2, start: '09:00', end: '17:00' },
  ],
  overrides: [{ date: '2026-12-24', start: null, end: null }],
}

let settings: SchedulingSettings
let holidays: Holiday[]
let eventTypes: EventType[]
let hours: HostHours
let connections: Connections
let feed: Feed | null
let calls: string[] = []

export function resetSchedulingSettings(
  over: {
    settings?: Partial<SchedulingSettings>
    holidays?: Holiday[]
    eventTypes?: EventType[]
    hours?: Partial<HostHours>
    providers?: Provider[]
    connections?: Connection[]
    feed?: Feed | null
  } = {},
) {
  settings = { ...DEFAULT_SETTINGS, ...over.settings }
  holidays = over.holidays ?? []
  eventTypes = over.eventTypes ?? []
  hours = { ...sampleHours, ...over.hours }
  connections = {
    providers: over.providers ?? ['google', 'microsoft'],
    data: over.connections ?? [],
  }
  feed = over.feed ?? null
  calls = []
}
resetSchedulingSettings()

/** Writes the fake has seen since the last reset ("DELETE /scheduling/calendars/cal_x?keep_events=true"). */
export const schedulingCalls = () => calls

const note = (request: Request) => {
  const url = new URL(request.url)
  calls.push(`${request.method} ${url.pathname.replace('/api/v1', '')}${url.search}`)
}

/** The country's and canton's days, as the API would suggest them (a short fixed list: not the real rules). */
const suggestions = (year: number): Holiday[] => [
  { date: `${year}-01-01`, name: 'New Year’s Day' },
  { date: `${year}-08-01`, name: 'Swiss National Day' },
  { date: `${year}-12-25`, name: 'Christmas Day' },
]

const checkEventType = (input: EventTypeInput) =>
  !input.name?.trim()
    ? fail(422, 'validation_failed', 'Check the fields.', { name: 'Enter a name.' })
    : null

export const schedulingSettingsHandlers = [
  http.get('/api/v1/scheduling/settings', () => HttpResponse.json({ data: settings })),
  http.put<never, SchedulingSettings>('/api/v1/scheduling/settings', async ({ request }) => {
    note(request)
    const body = await request.json()
    if (body.notice_minutes < 0 || body.notice_minutes > 20160)
      return fail(422, 'validation_failed', 'Check the fields.', {
        notice_minutes: 'Enter between 0 minutes and 14 days.',
      })
    settings = body
    return HttpResponse.json({ data: settings })
  }),
  http.get('/api/v1/scheduling/holidays', ({ request }) => {
    const url = new URL(request.url)
    if (url.searchParams.has('suggest'))
      return HttpResponse.json({
        data: { days: suggestions(Number(url.searchParams.get('year'))) },
      })
    return HttpResponse.json({ data: { days: holidays } })
  }),
  http.put<never, { days: Holiday[] }>('/api/v1/scheduling/holidays', async ({ request }) => {
    note(request)
    holidays = (await request.json()).days.toSorted((a, b) => a.date.localeCompare(b.date))
    return HttpResponse.json({ data: { days: holidays } })
  }),
  http.get('/api/v1/scheduling/event-types', () => HttpResponse.json({ data: eventTypes })),
  http.post<never, EventTypeInput>('/api/v1/scheduling/event-types', async ({ request }) => {
    note(request)
    const body = await request.json()
    const refused = checkEventType(body)
    if (refused) return refused
    const created: EventType = { ...body, id: `set_${eventTypes.length + 1}`, archived_at: null }
    eventTypes = [...eventTypes, created]
    return HttpResponse.json({ data: created }, { status: 201 })
  }),
  http.patch<{ id: string }, EventTypeInput>(
    '/api/v1/scheduling/event-types/:id',
    async ({ request, params }) => {
      note(request)
      const body = await request.json()
      const refused = checkEventType(body)
      if (refused) return refused
      const found = eventTypes.find((type) => type.id === params.id)
      if (!found) return fail(404, 'not_found', 'Not found.')
      const next = { ...found, ...body }
      eventTypes = eventTypes.map((type) => (type.id === params.id ? next : type))
      return HttpResponse.json({ data: next })
    },
  ),
  http.delete('/api/v1/scheduling/event-types/:id', ({ request, params }) => {
    note(request)
    eventTypes = eventTypes.filter((type) => type.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/v1/scheduling/hosts/:id', () => HttpResponse.json({ data: hours })),
  http.put<never, HostHours>('/api/v1/scheduling/hosts/:id', async ({ request }) => {
    note(request)
    hours = { ...(await request.json()), saved: true }
    return HttpResponse.json({ data: hours })
  }),
  http.get('/api/v1/scheduling/calendars', () => HttpResponse.json(connections)),
  http.patch<{ id: string }, Partial<Connection>>(
    '/api/v1/scheduling/calendars/:id',
    async ({ request, params }) => {
      note(request)
      const body = await request.json()
      const found = connections.data.find((one) => one.id === params.id)
      if (!found) return fail(404, 'not_found', 'Not found.')
      const next = { ...found, ...body }
      connections = {
        ...connections,
        data: connections.data.map((one) => (one.id === params.id ? next : one)),
      }
      return HttpResponse.json({ data: next })
    },
  ),
  http.post('/api/v1/scheduling/calendars/:id/sync', ({ request }) => {
    note(request)
    return new HttpResponse(null, { status: 202 })
  }),
  http.delete('/api/v1/scheduling/calendars/:id', ({ request, params }) => {
    note(request)
    connections = {
      ...connections,
      data: connections.data.filter((one) => one.id !== params.id),
    }
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/v1/scheduling/feed', () => HttpResponse.json({ data: feed })),
  http.post('/api/v1/scheduling/feed', ({ request }) => {
    note(request)
    feed = {
      url: `https://app.helvetly.com/api/v1/public/calendar/${feed ? 'rotated' : 'first'}-token.ics`,
      created_at: '2026-11-23T09:00:00Z',
      last_fetched_at: null,
    }
    return HttpResponse.json({ data: feed }, { status: 201 })
  }),
  http.delete('/api/v1/scheduling/feed', ({ request }) => {
    note(request)
    feed = null
    return new HttpResponse(null, { status: 204 })
  }),
]
