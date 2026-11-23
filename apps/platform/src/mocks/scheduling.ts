// Scheduling (occurrences, events, busy times, requests, settings), as the Go API answers per the scheduling contract.
// "Me" is the stories' signed-in person, Anna Muster (usr_story). Each call of `schedulingHandlers` keeps its own
// state, so a story's writes never leak into the next one.
import { http, HttpResponse } from 'msw'

import {
  expandDates,
  instantOf,
  isOpen,
  minutesOf,
  type Busy,
  type EventInput,
  type EventType,
  type Occurrence,
  type RequestItem,
  type SchedEvent,
  type Settings,
} from '@/lib/scheduling'

export const ME = { id: 'usr_story', name: 'Anna Muster' }
export const LUCA = { id: 'usr_2', name: 'Luca Rossi' }
export const MIA = { id: 'usr_3', name: 'Mia Keller' }
const ALPENGLOW = { id: 'cli_01', name: 'Alpenglow Studio GmbH' }
const KELLER = { id: 'cli_02', name: 'Keller Holzbau AG' }
const MEIER = { id: 'cli_03', name: 'Meier & Partner' }
const COACHING = { id: 'eng_1', number: 7, title: 'Coaching package', unit: 'piece' }

/** The stories' "now": Wednesday 2 December 2026, 09:30 in Zurich. */
export const STORY_NOW = new Date('2026-12-02T08:30:00Z')
const ZONE = 'Europe/Zurich'

const at = (date: string, time: string) => instantOf(date, minutesOf(time), ZONE).toISOString()

export const member = (person: { id: string; name: string }, role = 'member') => ({
  user_id: person.id,
  name: person.name,
  email: `${person.name.split(' ')[0]?.toLowerCase()}@example.com`,
  avatar_url: null,
  role,
  scopes: null,
  joined_at: '2026-01-01T00:00:00Z',
  last_active_at: null,
  is_you: person.id === ME.id,
})
export const TEAM = [member(ME, 'owner'), member(LUCA), member(MIA)]

export const settings = (over: Partial<Settings> = {}): Settings => ({
  booking_mode: 'staff',
  confirmation: 'auto',
  notice_minutes: 1440,
  cutoff_time: null,
  cutoff_days: [1, 2, 3, 4, 5],
  cutoff_skips_holidays: true,
  auto_approve_on_time: true,
  late_cancel_counts: true,
  no_show_counts: true,
  late_reschedule_counts: false,
  client_reminders: [1440, 60],
  host_reminders: [],
  auto_attended_after_hours: null,
  feed_details: 'full',
  default_location: 'Bahnhofstrasse 1, 8001 Zürich',
  ...over,
})

export const eventType = (over: Partial<EventType> = {}): EventType => ({
  id: 'set_intro',
  name: 'Intro call',
  description: null,
  duration_minutes: 30,
  mode: 'online',
  meeting_provider: 'manual',
  location: null,
  unit_price: null,
  currency: null,
  host_ids: [],
  bookable: true,
  archived_at: null,
  ...over,
})

export const event = (over: Partial<SchedEvent> = {}): SchedEvent => ({
  id: 'sev_1',
  client: ALPENGLOW,
  engagement: null,
  event_type_id: null,
  host: ME,
  title: 'Strategy session',
  description: null,
  client_note: null,
  mode: 'live',
  meeting: null,
  location: 'Bahnhofstrasse 1, 8001 Zürich',
  time_zone: ZONE,
  starts_local: '2026-12-02T10:00',
  duration_minutes: 60,
  recurrence: null,
  skip_holidays: false,
  attendees: ['lena@alpenglow.example'],
  units_per_session: null,
  unit_price: null,
  currency: null,
  sequence: 0,
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
  ...over,
})

export const occurrence = (over: Partial<Occurrence> = {}): Occurrence => {
  const starts = over.starts_at ?? at('2026-12-02', '10:00')
  return {
    id: 'soc_1',
    event_id: 'sev_1',
    original_start: starts,
    starts_at: starts,
    ends_at: new Date(Date.parse(starts) + 3_600_000).toISOString(),
    status: 'scheduled',
    late: false,
    counts: false,
    waived: null,
    title: 'Strategy session',
    location: 'Bahnhofstrasse 1, 8001 Zürich',
    meeting: null,
    host: ME,
    client: ALPENGLOW,
    engagement: null,
    is_exception: false,
    sequence: 0,
    request: null,
    entry_ids: [],
    invoice: null,
    updated_at: '2026-11-20T10:00:00Z',
    ...over,
  }
}

const session = (
  id: string,
  date: string,
  time: string,
  minutes: number,
  over: Partial<Occurrence> = {},
) => {
  const starts = at(date, time)
  return occurrence({
    id,
    starts_at: starts,
    original_start: starts,
    ends_at: new Date(Date.parse(starts) + minutes * 60_000).toISOString(),
    ...over,
  })
}

/** A week of three hosts: a weekly coaching series, overlaps on Wednesday, one past session to mark, a cancellation. */
export function sampleWeek(): Occurrence[] {
  const coaching = {
    event_id: 'sev_series',
    title: 'Coaching',
    client: KELLER,
    engagement: COACHING,
  }
  return [
    session('soc_mark', '2026-11-30', '14:00', 60, { title: 'Kick-off', client: MEIER }),
    session('soc_attended', '2026-12-01', '09:00', 60, {
      ...coaching,
      status: 'attended',
      counts: true,
      entry_ids: ['ent_1'],
    }),
    session('soc_1', '2026-12-02', '10:00', 60, { title: 'Strategy session' }),
    session('soc_overlap', '2026-12-02', '10:30', 60, {
      title: 'Design review',
      host: LUCA,
      client: MEIER,
    }),
    session('soc_overlap2', '2026-12-02', '11:00', 30, {
      title: 'Quick check-in',
      host: MIA,
      client: KELLER,
    }),
    session('soc_requested', '2026-12-03', '15:00', 30, {
      title: 'Intro call',
      status: 'requested',
      client: MEIER,
      request: {
        id: 'srq_booking',
        occurrence_id: 'soc_requested',
        kind: 'booking',
        status: 'pending',
        late: false,
        proposed_times: [],
        staff_proposal: null,
        note: null,
        reason: null,
        created_at: '2026-12-01T12:00:00Z',
        decided_at: null,
      },
    }),
    session('soc_series_2', '2026-12-08', '09:00', 60, {
      ...coaching,
      original_start: at('2026-12-08', '09:00'),
    }),
    session('soc_cancelled', '2026-12-04', '13:00', 60, {
      title: 'Workshop',
      status: 'cancelled_late',
      late: true,
      counts: true,
      host: LUCA,
    }),
    session('soc_series_1', '2026-12-04', '09:00', 60, { ...coaching }),
  ]
}

export const sampleRequests = (): RequestItem[] => [
  {
    id: 'srq_cancel',
    occurrence_id: 'soc_series_1',
    kind: 'cancel',
    status: 'pending',
    late: true,
    proposed_times: [],
    staff_proposal: null,
    note: 'Our team is at a trade fair that week.',
    reason: null,
    created_at: '2026-12-02T07:00:00Z',
    decided_at: null,
    occurrence: {
      id: 'soc_series_1',
      title: 'Coaching',
      starts_at: at('2026-12-04', '09:00'),
      ends_at: at('2026-12-04', '10:00'),
      client: KELLER,
      host: ME,
    },
  },
  {
    id: 'srq_move',
    occurrence_id: 'soc_series_2',
    kind: 'reschedule',
    status: 'pending',
    late: false,
    proposed_times: [at('2026-12-09', '14:00'), at('2026-12-10', '09:00')],
    staff_proposal: null,
    note: null,
    reason: null,
    created_at: '2026-12-01T16:00:00Z',
    decided_at: null,
    occurrence: {
      id: 'soc_series_2',
      title: 'Coaching',
      starts_at: at('2026-12-08', '09:00'),
      ends_at: at('2026-12-08', '10:00'),
      client: KELLER,
      host: ME,
    },
  },
]

export const sampleBusy = (): Busy[] => [
  { host_id: ME.id, starts_at: at('2026-12-02', '13:00'), ends_at: at('2026-12-02', '14:30') },
  { host_id: LUCA.id, starts_at: at('2026-12-03', '08:00'), ends_at: at('2026-12-03', '09:00') },
]

export type SchedulingState = {
  occurrences: Occurrence[]
  events: SchedEvent[]
  busy: Busy[]
  requests: RequestItem[]
  settings: Settings
  eventTypes: EventType[]
  /** Providers the host has connected (`GET /scheduling/calendars`). */
  connected: ('google' | 'microsoft')[]
  /** The workspace's days off (`GET /scheduling/holidays`). */
  holidays?: { date: string; name: string }[]
}

export const sampleState = (over: Partial<SchedulingState> = {}): SchedulingState => ({
  occurrences: sampleWeek(),
  events: [
    event(),
    event({
      id: 'sev_series',
      title: 'Coaching',
      client: KELLER,
      engagement: COACHING,
      starts_local: '2026-12-01T09:00',
      recurrence: {
        freq: 'weekly',
        interval: 1,
        by_day: ['TU', 'FR'],
        count: 12,
        rrule: 'FREQ=WEEKLY;BYDAY=TU,FR;COUNT=12',
      },
    }),
  ],
  busy: sampleBusy(),
  requests: sampleRequests(),
  settings: settings(),
  eventTypes: [
    eventType(),
    eventType({ id: 'set_session', name: 'Coaching session', duration_minutes: 60, mode: 'live' }),
  ],
  connected: ['google'],
  ...over,
})

export const emptyState = (): SchedulingState =>
  sampleState({
    occurrences: [],
    events: [],
    busy: [],
    requests: [],
    eventTypes: [],
    connected: [],
  })

const fail = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
const notFound = () => fail(404, 'not_found', 'Not found.')
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd)
const hostsOf = (host: string | null) =>
  !host || host === 'all' ? null : host.split(',').map((id) => (id === 'me' ? ME.id : id))

/** The fake API over `state`; `now` decides what is past (the stories' fixed clock by default). */
export function schedulingHandlers(state: SchedulingState = sampleState(), now = STORY_NOW) {
  const find = (id: string) => state.occurrences.find((entry) => entry.id === id)
  const replace = (next: Occurrence) => {
    state.occurrences = state.occurrences.map((entry) => (entry.id === next.id ? next : entry))
    return next
  }
  const eventOf = (entry: Occurrence) =>
    state.events.find((candidate) => candidate.id === entry.event_id)
  const conflictsFor = (hostId: string, starts: string, ends: string, exclude?: string) => [
    ...state.occurrences
      .filter(
        (entry) =>
          entry.id !== exclude &&
          entry.host?.id === hostId &&
          isOpen(entry.status) &&
          overlaps(starts, ends, entry.starts_at, entry.ends_at),
      )
      .map((entry) => ({
        kind: 'event' as const,
        starts_at: entry.starts_at,
        ends_at: entry.ends_at,
        occurrence_id: entry.id,
        title: entry.title,
      })),
    ...state.busy
      .filter(
        (block) =>
          block.host_id === hostId && overlaps(starts, ends, block.starts_at, block.ends_at),
      )
      .map((block) => ({
        kind: 'busy' as const,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
      })),
  ]

  return [
    http.get('/api/v1/scheduling/occurrences', ({ request }) => {
      const query = new URL(request.url).searchParams
      const from = query.get('from') ?? ''
      const to = query.get('to') ?? ''
      const hosts = hostsOf(query.get('host'))
      const statuses = query.get('status')?.split(',')
      const data = state.occurrences
        .filter(
          (entry) =>
            (!from || entry.ends_at > from) &&
            (!to || entry.starts_at < to) &&
            (!hosts || hosts.includes(entry.host?.id ?? '')) &&
            (!query.get('client_id') || entry.client.id === query.get('client_id')) &&
            (!query.get('engagement_id') || entry.engagement?.id === query.get('engagement_id')) &&
            (!statuses || statuses.includes(entry.status)) &&
            (query.get('to_mark') !== 'true' ||
              (isOpen(entry.status) && Date.parse(entry.ends_at) < now.getTime())),
        )
        .toSorted((a, b) => a.starts_at.localeCompare(b.starts_at))
      return HttpResponse.json({ data })
    }),
    http.get<{ id: string }>('/api/v1/scheduling/occurrences/:id', ({ params }) => {
      const found = find(params.id)
      if (!found) return notFound()
      const conflicts = found.host
        ? conflictsFor(found.host.id, found.starts_at, found.ends_at, found.id)
        : []
      return HttpResponse.json({ data: { ...found, conflicts } })
    }),
    http.get<{ id: string }>('/api/v1/scheduling/events/:id', ({ params }) => {
      const found = state.events.find((entry) => entry.id === params.id)
      return found ? HttpResponse.json({ data: found }) : notFound()
    }),
    http.get('/api/v1/scheduling/busy', ({ request }) => {
      const query = new URL(request.url).searchParams
      const hosts = hostsOf(query.get('host'))
      const data = state.busy.filter(
        (block) =>
          (!hosts || hosts.includes(block.host_id)) &&
          overlaps(
            query.get('from') ?? '',
            query.get('to') ?? '9999',
            block.starts_at,
            block.ends_at,
          ),
      )
      return HttpResponse.json({ data })
    }),
    http.get('/api/v1/scheduling/conflicts', ({ request }) => {
      const query = new URL(request.url).searchParams
      return HttpResponse.json({
        data: conflictsFor(
          query.get('host_id') ?? '',
          query.get('starts_at') ?? '',
          query.get('ends_at') ?? '',
          query.get('exclude') ?? undefined,
        ),
      })
    }),
    http.post('/api/v1/scheduling/events', async ({ request }) => {
      const input = (await request.json()) as EventInput
      const fields: Record<string, string> = {}
      if (!input.client_id) fields.client_id = 'Choose a client.'
      if (!input.title?.trim()) fields.title = 'Enter a title.'
      if (!(input.duration_minutes >= 5 && input.duration_minutes <= 720))
        fields.duration_minutes = 'Between 5 and 720 minutes.'
      if (Object.keys(fields).length > 0)
        return fail(422, 'validation_failed', 'Check the fields.', { fields })
      const offDay = (state.holidays ?? []).find(
        (day) => day.date === input.starts_local.slice(0, 10),
      )
      if (offDay && !input.recurrence && !input.allow_day_off)
        return fail(409, 'day_off', `This day is a day off (${offDay.name}).`, offDay)
      const id = `sev_${state.events.length + 1}`
      const host = TEAM.find((entry) => entry.user_id === input.host_id)
      const created = event({
        id,
        title: input.title,
        host: host ? { id: host.user_id, name: host.name } : ME,
        client: { id: input.client_id, name: 'Alpenglow Studio GmbH' },
        starts_local: input.starts_local,
        duration_minutes: input.duration_minutes,
        mode: input.mode,
        location: input.location,
        meeting: input.meeting,
        recurrence: input.recurrence,
        time_zone: input.time_zone,
      })
      state.events.push(created)
      const [date = '', time = '00:00'] = input.starts_local.split('T')
      const dates = input.recurrence ? expandDates(input.recurrence, date, 20) : [date]
      const made = dates.map((day, index) => {
        const starts = instantOf(day, minutesOf(time), input.time_zone).toISOString()
        return occurrence({
          id: `soc_${id}_${index}`,
          event_id: id,
          starts_at: starts,
          original_start: starts,
          ends_at: new Date(Date.parse(starts) + input.duration_minutes * 60_000).toISOString(),
          title: input.title,
          host: created.host,
          client: created.client,
        })
      })
      state.occurrences.push(...made)
      const first = made[0]
      const conflicts =
        first && created.host
          ? conflictsFor(created.host.id, first.starts_at, first.ends_at, first.id)
          : []
      return HttpResponse.json(
        { data: { event: created, occurrences: made, conflicts } },
        { status: 201 },
      )
    }),
    http.patch<{ id: string }>(
      '/api/v1/scheduling/occurrences/:id',
      async ({ params, request }) => {
        const found = find(params.id)
        if (!found) return notFound()
        if (!isOpen(found.status)) return fail(409, 'occurrence_closed', 'This session is closed.')
        const body = (await request.json()) as Partial<EventInput> & { scope: string }
        const zone = body.time_zone ?? eventOf(found)?.time_zone ?? ZONE
        let next: Occurrence = {
          ...found,
          sequence: found.sequence + 1,
          title: body.title ?? found.title,
        }
        if (body.starts_local || body.duration_minutes) {
          const [date = '', time = '00:00'] = (body.starts_local ?? '').split('T')
          const starts = body.starts_local
            ? instantOf(date, minutesOf(time), zone).toISOString()
            : found.starts_at
          const minutes =
            body.duration_minutes ??
            (Date.parse(found.ends_at) - Date.parse(found.starts_at)) / 60_000
          next = {
            ...next,
            starts_at: starts,
            ends_at: new Date(Date.parse(starts) + minutes * 60_000).toISOString(),
            status: starts === found.starts_at ? found.status : 'rescheduled',
            is_exception: body.scope === 'this' || found.is_exception,
          }
        }
        const retimed = next.starts_at !== found.starts_at || next.ends_at !== found.ends_at
        if (retimed && Date.parse(found.starts_at) <= STORY_NOW.getTime())
          return fail(409, 'occurrence_started', "This session has started; its time can't change.")
        if (body.host_id) {
          const host = TEAM.find((entry) => entry.user_id === body.host_id)
          if (host) next.host = { id: host.user_id, name: host.name }
        }
        replace(next)
        return HttpResponse.json({ data: next, details: body.scope === 'all' ? { kept: 1 } : {} })
      },
    ),
    http.post<{ id: string }>(
      '/api/v1/scheduling/occurrences/:id/cancel',
      async ({ params, request }) => {
        const found = find(params.id)
        if (!found) return notFound()
        if (!isOpen(found.status)) return fail(409, 'occurrence_closed', 'This session is closed.')
        const body = (await request.json()) as { as: 'on_time' | 'late' }
        const late = body.as === 'late'
        return HttpResponse.json({
          data: replace({
            ...found,
            status: late ? 'cancelled_late' : 'cancelled_on_time',
            late,
            counts: late,
          }),
        })
      },
    ),
    http.post<{ id: string }>(
      '/api/v1/scheduling/occurrences/:id/attendance',
      async ({ params, request }) => {
        const found = find(params.id)
        if (!found) return notFound()
        const body = (await request.json()) as {
          status?: Occurrence['status']
          waive?: boolean
          reason?: string
        }
        if (body.waive)
          return HttpResponse.json({
            data: replace({
              ...found,
              counts: false,
              entry_ids: [],
              waived: { by: ME, at: now.toISOString(), reason: body.reason ?? null },
            }),
          })
        if (!body.status)
          return fail(422, 'validation_failed', 'Check the fields.', {
            fields: { status: 'Choose a status.' },
          })
        if (body.status !== 'scheduled' && Date.parse(found.starts_at) > now.getTime())
          return fail(409, 'not_started', 'This session has not started yet.')
        const counts = body.status === 'attended' || body.status === 'no_show'
        return HttpResponse.json({
          data: replace({
            ...found,
            status: body.status,
            counts,
            entry_ids: counts && found.engagement ? ['ent_new'] : [],
          }),
        })
      },
    ),
    http.get('/api/v1/scheduling/requests', () =>
      HttpResponse.json({
        data: state.requests.filter(
          (entry) => entry.status === 'pending' || entry.status === 'proposed',
        ),
      }),
    ),
    ...(['approve', 'decline', 'propose'] as const).map((action) =>
      http.post<{ id: string }>(
        `/api/v1/scheduling/requests/:id/${action}`,
        async ({ params, request }) => {
          const found = state.requests.find((entry) => entry.id === params.id)
          if (!found) return notFound()
          const body = (await request.json()) as { starts_at?: string; reason?: string }
          if (action === 'propose' && !body.starts_at)
            return fail(422, 'validation_failed', 'Check the fields.', {
              fields: { starts_at: 'Pick a time.' },
            })
          const status =
            action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'proposed'
          state.requests = state.requests.map((entry) =>
            entry.id === found.id
              ? { ...entry, status, staff_proposal: body.starts_at ?? null }
              : entry,
          )
          const target = find(found.occurrence_id)
          if (action !== 'approve' || !target) return HttpResponse.json({ data: target ?? null })
          if (found.kind === 'cancel') {
            const late = found.late
            return HttpResponse.json({
              data: replace({
                ...target,
                status: late ? 'cancelled_late' : 'cancelled_on_time',
                late,
                counts: late,
                request: null,
              }),
            })
          }
          const starts = body.starts_at ?? target.starts_at
          const length = Date.parse(target.ends_at) - Date.parse(target.starts_at)
          return HttpResponse.json({
            data: replace({
              ...target,
              starts_at: starts,
              ends_at: new Date(Date.parse(starts) + length).toISOString(),
              status: found.kind === 'booking' ? 'scheduled' : 'rescheduled',
              request: null,
            }),
          })
        },
      ),
    ),
    http.get('/api/v1/scheduling/settings', () => HttpResponse.json({ data: state.settings })),
    http.get('/api/v1/scheduling/holidays', () =>
      HttpResponse.json({ data: { days: state.holidays ?? [] } }),
    ),
    http.get('/api/v1/scheduling/event-types', () => HttpResponse.json({ data: state.eventTypes })),
    http.get<{ id: string }>('/api/v1/scheduling/hosts/:id', () =>
      HttpResponse.json({
        data: { time_zone: ZONE, bookable: true, color: null, weekly: [], overrides: [] },
      }),
    ),
    http.get('/api/v1/scheduling/calendars', () =>
      HttpResponse.json({
        providers: ['google', 'microsoft'],
        data: state.connected.map((provider, index) => ({
          id: `cal_${index}`,
          provider,
          status: 'active',
        })),
      }),
    ),
  ]
}
