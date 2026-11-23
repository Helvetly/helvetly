// MSW handlers with sample sessions and booking for Vitest and Storybook only (scheduling-contract.md, "Portal").
import { http, HttpResponse } from 'msw'

import type {
  BookingInfo,
  Booked,
  ClientSession,
  LinkInfo,
  SessionRequest,
  Slot,
} from '@/lib/scheduling'

const S = '/api/v1/public/portal/scheduling'
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
/** A whole hour `hours` from now, so stories read the same at any minute. */
const at = (hours: number) => {
  const d = new Date(Date.now() + hours * HOUR)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

const session = (over: Partial<ClientSession> & Pick<ClientSession, 'id'>): ClientSession => {
  const start = at(72)
  return {
    title: 'Coaching session',
    starts_at: iso(start),
    ends_at: iso(start + HOUR),
    time_zone: 'Europe/Zurich',
    status: 'scheduled',
    late: false,
    mode: 'live',
    meeting_url: null,
    location: 'Bahnhofstrasse 1, 8001 Zürich',
    host_name: 'Lea Meier',
    client_note: 'Please bring last month’s figures.',
    request: null,
    deadline: iso(start - 24 * HOUR),
    can_cancel: true,
    can_reschedule: true,
    late_cancel_counts: true,
    late_reschedule_counts: false,
    ...over,
  }
}

export const request = (over: Partial<SessionRequest> & Pick<SessionRequest, 'id'>) =>
  ({
    occurrence_id: 'soc_1',
    kind: 'cancel',
    status: 'pending',
    late: false,
    proposed_times: [],
    staff_proposal: null,
    note: null,
    reason: null,
    created_at: iso(Date.now() - HOUR),
    decided_at: null,
    ...over,
  }) satisfies SessionRequest

/** An online session within 24 h (its link shows), a live one on time, and one whose cancellation is late. */
export const upcomingSessions: ClientSession[] = [
  session({
    id: 'soc_soon',
    title: 'Strategy call',
    starts_at: iso(at(3)),
    ends_at: iso(at(3) + HOUR),
    mode: 'online',
    meeting_url: 'https://meet.example.com/abc-defg-hij',
    location: null,
    client_note: null,
    deadline: iso(at(3) - 24 * HOUR),
  }),
  session({ id: 'soc_1' }),
  session({
    id: 'soc_moved',
    title: 'Quarterly review',
    status: 'rescheduled',
    starts_at: iso(at(240)),
    ends_at: iso(at(240) + 2 * HOUR),
    deadline: iso(at(240) - 24 * HOUR),
    client_note: null,
  }),
]

export const pastSessions: ClientSession[] = [
  session({
    id: 'soc_past1',
    status: 'attended',
    starts_at: iso(at(-48)),
    ends_at: iso(at(-47)),
    deadline: null,
    can_cancel: false,
    can_reschedule: false,
  }),
  session({
    id: 'soc_past2',
    status: 'cancelled_late',
    late: true,
    starts_at: iso(at(-200)),
    ends_at: iso(at(-199)),
    deadline: null,
    can_cancel: false,
    can_reschedule: false,
  }),
  session({
    id: 'soc_past3',
    status: 'no_show',
    starts_at: iso(at(-400)),
    ends_at: iso(at(-399)),
    deadline: null,
    can_cancel: false,
    can_reschedule: false,
  }),
]

export const bookingInfo: BookingInfo = {
  mode: 'clients',
  confirmation: 'auto',
  policy_text: 'Free cancellation up to 24 hours before the start.',
  event_types: [
    {
      id: 'set_trial',
      name: 'Trial lesson',
      description: 'A first meeting to get to know each other.',
      duration_minutes: 60,
      mode: 'live',
      price: '90.00',
      currency: 'CHF',
      hosts: [
        { id: 'usr_lea', name: 'Lea Meier' },
        { id: 'usr_tom', name: 'Tom Huber' },
      ],
      engagements: [],
    },
    {
      id: 'set_call',
      name: 'Follow-up call',
      description: null,
      duration_minutes: 30,
      mode: 'online',
      price: null,
      currency: null,
      hosts: [{ id: 'usr_lea', name: 'Lea Meier' }],
      engagements: [
        { id: 'eng_1', name: 'Coaching package 10' },
        { id: 'eng_2', name: 'Support retainer' },
      ],
    },
  ],
}

export const linkInfo: LinkInfo = {
  workspace: 'Muster GmbH',
  confirmation: 'auto',
  policy_text: bookingInfo.policy_text,
  event_types: [bookingInfo.event_types[0]!],
}

/** Free starts on the days of [from, to): 09:00, 10:00 and 14:00 browser time, from tomorrow on. */
export function mockSlots(from: Date, to: Date, hostId = 'usr_lea'): Slot[] {
  const out: Slot[] = []
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  const days = Math.round((to.getTime() - from.getTime()) / (24 * HOUR))
  for (let i = 0; i < days; i++) {
    const day = new Date(from)
    day.setDate(day.getDate() + i)
    if (day < tomorrow) continue
    for (const hour of [9, 10, 14]) {
      const start = new Date(day)
      start.setHours(hour, 0, 0, 0)
      out.push({ starts_at: start.toISOString(), host_id: hostId })
    }
  }
  return out
}

const slotsAnswer = ({ request: req }: { request: Request }) => {
  const url = new URL(req.url)
  const from = new Date(url.searchParams.get('from') ?? Date.now())
  const to = new Date(url.searchParams.get('to') ?? Date.now())
  return HttpResponse.json({
    data: mockSlots(from, to, url.searchParams.get('host_id') ?? 'usr_lea'),
  })
}

const bookedAnswer = async ({ request: req }: { request: Request }) => {
  const sent = (await req.json()) as { starts_at: string }
  const booked: Booked = {
    id: 'soc_new',
    title: 'Trial lesson',
    starts_at: sent.starts_at,
    ends_at: iso(Date.parse(sent.starts_at) + HOUR),
    status: 'scheduled',
    host_name: 'Lea Meier',
  }
  return HttpResponse.json({ data: booked }, { status: 201 })
}

export const schedulingHandlers = [
  http.get(`${S}/occurrences`, ({ request: req }) =>
    HttpResponse.json({
      data: new URL(req.url).searchParams.get('when') === 'past' ? pastSessions : upcomingSessions,
    }),
  ),
  http.post<{ id: string }>(`${S}/occurrences/:id/cancel-request`, ({ params }) =>
    HttpResponse.json(
      { data: request({ id: 'srq_new', occurrence_id: params.id, status: 'approved' }) },
      { status: 200 },
    ),
  ),
  http.post<{ id: string }>(`${S}/occurrences/:id/reschedule-request`, ({ params }) =>
    HttpResponse.json(
      { data: request({ id: 'srq_new', occurrence_id: params.id, kind: 'reschedule' }) },
      { status: 201 },
    ),
  ),
  http.post<{ id: string; answer: string }>(`${S}/requests/:id/:answer`, ({ params }) =>
    HttpResponse.json({
      data: request({
        id: params.id,
        status: params.answer === 'accept' ? 'accepted' : 'declined',
      }),
    }),
  ),
  http.delete(`${S}/requests/:id`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${S}/booking`, () => HttpResponse.json(bookingInfo)),
  http.get(`${S}/booking/slots`, slotsAnswer),
  http.post(`${S}/booking`, bookedAnswer),
  http.get(`${S}/link`, () => HttpResponse.json(linkInfo)),
  http.get(`${S}/link/slots`, slotsAnswer),
  http.post(`${S}/link/book`, bookedAnswer),
]

/** A workspace without Scheduling (the default of the other portal stories): no tab, no card, no booking. */
export const schedulingOffHandlers = [
  http.get(`${S}/booking`, () =>
    HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }),
  ),
  http.get(`${S}/occurrences`, () => HttpResponse.json({ data: [] })),
]
