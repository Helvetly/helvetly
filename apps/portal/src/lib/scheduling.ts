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
