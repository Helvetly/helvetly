// Sessions and booking in the portal, typed by hand from "Portal" in docs/architecture/contracts/scheduling-contract.md.
import { languageTag } from '@helvetly/i18n'
import { ApiError, apiUrl, request } from '@helvetly/ui/lib/http'
import { useQuery } from '@tanstack/react-query'

import { translate } from '@/lib/i18n'

export type SessionStatus =
  | 'requested'
  | 'scheduled'
  | 'rescheduled'
  | 'attended'
  | 'no_show'
  | 'cancelled_on_time'
  | 'cancelled_late'
  | 'declined'

export type SessionRequest = {
  id: string
  occurrence_id: string
  kind: 'cancel' | 'reschedule' | 'booking'
  status: 'pending' | 'proposed' | 'approved' | 'declined' | 'accepted' | 'withdrawn' | 'expired'
  /** Fixed when the client asked. */
  late: boolean
  proposed_times: string[]
  /** The business's counter-proposal while `proposed`. */
  staff_proposal: string | null
  note: string | null
  reason: string | null
  created_at: string
  decided_at: string | null
}

/** A session as its client sees it. */
export type ClientSession = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  /** The client's zone, else the workspace's: times show in it. */
  time_zone: string
  status: SessionStatus
  late: boolean
  mode: 'online' | 'live'
  /** Open sessions only, from 24 h before the start. */
  meeting_url: string | null
  location: string | null
  host_name: string | null
  client_note: string | null
  request: SessionRequest | null
  /** The last moment a cancellation is on time; open sessions only. */
  deadline: string | null
  can_cancel: boolean
  can_reschedule: boolean
  late_cancel_counts: boolean
  late_reschedule_counts: boolean
  /** The series it belongs to; null for a one-off. */
  series: ClientSeries | null
  /** A series' session moved off its slot: the slot it had. */
  original_starts_at: string | null
}

/** A series as its card summarises it, the same on each of its sessions. */
export type ClientSeries = {
  id: string
  recurrence: {
    freq: 'weekly' | 'monthly' | ''
    interval: number
    /** "MO" … "SU". */
    by_day?: string[]
    rrule: string
  } | null
  /** The first session's start. */
  starts_at: string
  /** Its sessions not cancelled or declined; `left` those still to come. */
  total: number
  left: number
}

export type Ref = { id: string; name: string }

export type BookableType = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  mode: 'online' | 'live'
  price: string | null
  currency: string | null
  hosts: Ref[]
  /** The client's packages to choose from when several fit; empty otherwise. */
  engagements: Ref[]
}

export type BookingInfo = {
  mode: 'staff' | 'clients'
  confirmation: 'auto' | 'manual'
  policy_text: string
  event_types: BookableType[]
}

/** A booking link's page: whose link it is, and what it books. */
export type LinkInfo = Omit<BookingInfo, 'mode'> & { workspace: string }

export type Slot = { starts_at: string; host_id: string }

export type Booked = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  /** `requested` while the business has to confirm. */
  status: SessionStatus
  host_name: string | null
}

export type BookInput = {
  event_type_id: string
  host_id?: string
  starts_at: string
  engagement_id?: string
  note?: string
}

const base = '/public/portal/scheduling'
const id = encodeURIComponent
const call = <T>(path: string, options: Parameters<typeof request>[1] = {}) =>
  request<T>(base + path, { ...options, public: true })

export const sessionKeys = {
  all: ['portal', 'sessions'] as const,
  list: (when: 'upcoming' | 'past') => ['portal', 'sessions', when] as const,
  booking: ['portal', 'sessions', 'booking'] as const,
  slots: (typeId: string, hostId: string, from: string) =>
    ['portal', 'sessions', 'slots', typeId, hostId, from] as const,
  link: (token: string) => ['portal', 'booking-link', token] as const,
}

export const listSessions = async (when: 'upcoming' | 'past') =>
  (await call<{ data: ClientSession[] }>(`/occurrences?when=${when}`)).data

export const sessionIcsUrl = (sessionId: string) =>
  apiUrl(`${base}/occurrences/${id(sessionId)}/ics`)

export const seriesIcsUrl = (seriesId: string) => apiUrl(`${base}/series/${id(seriesId)}/ics`)

/** An on-time cancellation the business approves automatically comes back `approved`: the session is cancelled. */
export const requestCancel = async (sessionId: string, note: string) =>
  (
    await call<{ data: SessionRequest }>(`/occurrences/${id(sessionId)}/cancel-request`, {
      method: 'POST',
      json: note.trim() ? { note: note.trim() } : {},
    })
  ).data

export const requestReschedule = async (sessionId: string, times: string[], note: string) =>
  (
    await call<{ data: SessionRequest }>(`/occurrences/${id(sessionId)}/reschedule-request`, {
      method: 'POST',
      json: { proposed_times: times, ...(note.trim() ? { note: note.trim() } : {}) },
    })
  ).data

export const answerProposal = async (requestId: string, answer: 'accept' | 'decline') =>
  (
    await call<{ data: SessionRequest }>(`/requests/${id(requestId)}/${answer}`, {
      method: 'POST',
      json: {},
    })
  ).data

export const withdrawRequest = (requestId: string) =>
  call<void>(`/requests/${id(requestId)}`, { method: 'DELETE' })

/** null when the workspace's plan has no Scheduling (the API answers 404). */
export async function getBooking(): Promise<BookingInfo | null> {
  try {
    return await call<BookingInfo>('/booking')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

const range = (from: Date, to: Date) => `from=${id(from.toISOString())}&to=${id(to.toISOString())}`

export const listSlots = async (typeId: string, hostId: string, from: Date, to: Date) =>
  (
    await call<{ data: Slot[] }>(
      `/booking/slots?event_type_id=${id(typeId)}${hostId ? `&host_id=${id(hostId)}` : ''}&${range(from, to)}`,
    )
  ).data

/** A 409 `slot_taken` throws an ApiError: someone else booked the time first. */
export const book = async (input: BookInput) =>
  (await call<{ data: Booked }>('/booking', { method: 'POST', json: input })).data

export const getLink = (token: string) => call<LinkInfo>(`/link?link=${id(token)}`)

export const listLinkSlots = async (
  token: string,
  typeId: string,
  hostId: string,
  from: Date,
  to: Date,
) =>
  (
    await call<{ data: Slot[] }>(
      `/link/slots?link=${id(token)}&event_type_id=${id(typeId)}${hostId ? `&host_id=${id(hostId)}` : ''}&${range(from, to)}`,
    )
  ).data

export const bookWithLink = async (
  token: string,
  input: BookInput & { name: string; email: string },
) =>
  (await call<{ data: Booked }>(`/link/book?link=${id(token)}`, { method: 'POST', json: input }))
    .data

export const isSlotTaken = (error: unknown) =>
  error instanceof ApiError && error.code === 'slot_taken'

/** Still to come: it holds its time (scheduled, moved, or a booking waiting for confirmation). */
export const isOpen = (session: Pick<ClientSession, 'status'>) =>
  session.status === 'scheduled' ||
  session.status === 'rescheduled' ||
  session.status === 'requested'

/** "Zurich" for Europe/Zurich, "New York" for America/New_York. */
export const zoneName = (zone: string) => (zone.split('/').pop() ?? zone).replaceAll('_', ' ')

/** The browser's zone, which the API keeps as the client's on the first sign-in. */
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const format = (iso: string, zone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(languageTag, { timeZone: zone, ...options }).format(new Date(iso))

/** "Tue, 1 Dec 2026" in zone. */
export const formatDay = (iso: string, zone: string) =>
  format(iso, zone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

/** "09:00" in zone. */
export const formatClock = (iso: string, zone: string) =>
  format(iso, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "Tue, 1 Dec 2026 · 09:00–10:00". */
export const formatSpan = (startsAt: string, endsAt: string, zone: string) =>
  `${formatDay(startsAt, zone)} · ${formatClock(startsAt, zone)}–${formatClock(endsAt, zone)}`

/** Whether cancelling now is late (after the deadline). */
export const isLateNow = (session: Pick<ClientSession, 'deadline'>, now = new Date()) =>
  session.deadline !== null && now.getTime() > Date.parse(session.deadline)

/** "Free cancellation until Fri, 27 Nov 2026, 14:00", or that the free period has ended. */
export function deadlineText(session: ClientSession, now = new Date()) {
  if (!session.deadline) return ''
  if (isLateNow(session, now)) return translate('sessionsFreeCancellationOver')
  return translate('sessionsFreeCancellationUntil', {
    when: `${formatDay(session.deadline, session.time_zone)}, ${formatClock(session.deadline, session.time_zone)}`,
  })
}

/** What happens to a late request: it counts as a used session when the business counts it. */
export const lateCounts = (session: ClientSession, kind: 'cancel' | 'reschedule') =>
  kind === 'cancel' ? session.late_cancel_counts : session.late_reschedule_counts

/** The civil date ("2026-12-01") of an instant in zone. */
export const civilDay = (iso: string, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))

/** Slots by their day in zone, in order; each day's slots in order. */
export function slotsByDay(slots: Slot[], zone: string) {
  const days = new Map<string, Slot[]>()
  for (const slot of slots.toSorted((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const day = civilDay(slot.starts_at, zone)
    days.set(day, [...(days.get(day) ?? []), slot])
  }
  return [...days].map(([day, list]) => ({ day, slots: list }))
}

/** One slot per start: with "any host" several hosts may be free at the same time; the API picks one. */
export const uniqueStarts = (slots: Slot[]) =>
  slots.filter((slot, i) => slots.findIndex((s) => s.starts_at === slot.starts_at) === i)

/** The week [from, to) that starts `weeks` weeks after the start of today. */
export function weekRange(weeks: number, now = new Date()) {
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() + weeks * 7)
  const to = new Date(from)
  to.setDate(to.getDate() + 7)
  return { from, to }
}

/** The value of a datetime-local field as an RFC 3339 instant (the field is in the browser's zone). */
export const localToInstant = (value: string) => new Date(value).toISOString()

/**
 * Whether the Sessions tab shows: the plan has Scheduling (the booking page answers) and the client has a
 * session or may book.
 */
export function useSessionsVisible() {
  const booking = useQuery({ queryKey: sessionKeys.booking, queryFn: getBooking, retry: false })
  const needsList = booking.data?.mode === 'staff'
  const upcoming = useQuery({
    queryKey: sessionKeys.list('upcoming'),
    queryFn: () => listSessions('upcoming'),
    enabled: needsList,
    retry: false,
  })
  const past = useQuery({
    queryKey: sessionKeys.list('past'),
    queryFn: () => listSessions('past'),
    enabled: needsList && upcoming.data?.length === 0,
    retry: false,
  })
  if (!booking.data) return false
  return (
    booking.data.mode === 'clients' || Boolean(upcoming.data?.length) || Boolean(past.data?.length)
  )
}

/** One card on the Sessions page: a one-off session, or a series with its listed sessions in order. */
export type SessionGroup =
  | { kind: 'one'; session: ClientSession }
  | { kind: 'series'; series: ClientSeries; sessions: ClientSession[] }

/** Each series once, where its first listed session is; one-offs as they come. */
export function groupSessions(sessions: ClientSession[]): SessionGroup[] {
  const out: SessionGroup[] = []
  const series = new Map<string, ClientSession[]>()
  for (const session of sessions) {
    if (!session.series) {
      out.push({ kind: 'one', session })
      continue
    }
    const listed = series.get(session.series.id)
    if (listed) {
      listed.push(session)
      continue
    }
    const fresh = [session]
    series.set(session.series.id, fresh)
    out.push({ kind: 'series', series: session.series, sessions: fresh })
  }
  return out
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** "Tuesday" for "TU" in the reader's language (5 Jan 2025 is a Sunday). */
const weekdayName = (code: string) =>
  new Intl.DateTimeFormat(languageTag, { weekday: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2025, 0, 5 + DAY_CODES.indexOf(code)),
  )

/** The day code ("TU") of an instant in zone. */
const dayCode = (iso: string, zone: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone })
    .format(new Date(iso))
    .slice(0, 2)
    .toUpperCase()

/** "Every Tuesday, 20:30–23:00", from the series' rule and one of its sessions' times. */
export function ruleText(series: ClientSeries, session: ClientSession) {
  const time = `${formatClock(session.starts_at, session.time_zone)}–${formatClock(session.ends_at, session.time_zone)}`
  const rule = series.recurrence
  const interval = rule?.interval || 1
  let every = translate('sessionsRepeats')
  if (rule?.freq === 'weekly') {
    const codes = rule.by_day?.length
      ? rule.by_day.toSorted(
          (a, b) => ((DAY_CODES.indexOf(a) + 6) % 7) - ((DAY_CODES.indexOf(b) + 6) % 7),
        )
      : [dayCode(session.starts_at, session.time_zone)]
    const days = new Intl.ListFormat(languageTag, { type: 'conjunction' }).format(
      codes.map(weekdayName),
    )
    every = translate('sessionsEveryWeek', { interval, days })
  } else if (rule?.freq === 'monthly') {
    every = translate('sessionsEveryMonth', { interval })
  }
  return `${every}, ${time}`
}

/** "Free cancellation up to 24 hours before each session", from a session's deadline; '' without one. */
export function cancelRuleText(session: ClientSession) {
  if (!session.deadline) return ''
  const hours = Math.round(
    (Date.parse(session.starts_at) - Date.parse(session.deadline)) / 3_600_000,
  )
  return hours > 0 ? translate('sessionsFreeCancelRule', { hours }) : ''
}

/** "Today", "Tomorrow" or the day ("Tue, 1 Dec 2026") of an instant in zone, against the reader's today. */
export function relativeDay(iso: string, zone: string, now = new Date()) {
  const today = civilDay(now.toISOString(), zone)
  const days = Math.round((Date.parse(civilDay(iso, zone)) - Date.parse(today)) / 86_400_000)
  if (days === 0) return translate('today')
  if (days === 1) return translate('tomorrow')
  return formatDay(iso, zone)
}

const HOUR_MS = 3_600_000

/** Why a session is on the overview's to-do list: a proposal to answer, free cancellation ending, or it is soon. */
export type SessionAttention = {
  session: ClientSession
  reason: 'proposal' | 'deadline' | 'next'
  /** When it matters: the deadline, else the start. */
  at: number
}

/**
 * The sessions waiting for the client, one entry each: a time the business proposed, a free cancellation that ends
 * within 24 h, and the next session when it starts within 7 days.
 */
export function sessionAttention(sessions: ClientSession[], now = new Date()): SessionAttention[] {
  const t = now.getTime()
  const open = sessions.filter((s) => isOpen(s) && Date.parse(s.ends_at) > t)
  const out: SessionAttention[] = []
  for (const session of open) {
    const deadline = session.deadline ? Date.parse(session.deadline) : NaN
    if (session.request?.status === 'proposed')
      out.push({ session, reason: 'proposal', at: Date.parse(session.starts_at) })
    else if (session.can_cancel && deadline > t && deadline - t < 24 * HOUR_MS)
      out.push({ session, reason: 'deadline', at: deadline })
  }
  // The next session once: already listed for a proposal or its deadline, it is not listed again.
  const next = open[0]
  if (
    next &&
    !out.some((a) => a.session === next) &&
    Date.parse(next.starts_at) - t < 7 * 24 * HOUR_MS
  )
    out.push({ session: next, reason: 'next', at: Date.parse(next.starts_at) })
  return out
}
