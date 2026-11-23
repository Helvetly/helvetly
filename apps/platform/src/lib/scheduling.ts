'use client'
// Scheduling: sessions with clients, series, attendance and the portal's requests.
// Typed by hand from docs/architecture/contracts/scheduling-contract.md; served by Go, the handlers in
// src/mocks/scheduling.ts are a test-only fake.
import { languageTag } from '@helvetly/i18n'
import { apiUrl } from '@helvetly/ui/lib/http'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, errorMessage, request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import type { Decimal } from '@/lib/invoices'

export type Status =
  | 'requested'
  | 'scheduled'
  | 'rescheduled'
  | 'attended'
  | 'no_show'
  | 'cancelled_on_time'
  | 'cancelled_late'
  | 'declined'
/** Open sessions hold their slot, get reminders and count for conflicts. */
export const OPEN_STATUSES: readonly Status[] = ['requested', 'scheduled', 'rescheduled']
export const isOpen = (status: Status) => OPEN_STATUSES.includes(status)
export const STATUSES: readonly Status[] = [
  ...OPEN_STATUSES,
  'attended',
  'no_show',
  'cancelled_on_time',
  'cancelled_late',
  'declined',
]

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export type Recurrence = {
  freq: 'weekly' | 'monthly'
  interval: number
  by_day?: Weekday[]
  by_month_day?: number
  by_set_pos?: { pos: 1 | 2 | 3 | 4 | -1; day: Weekday }
  until?: string
  count?: number
  /** Read-only: the RFC 5545 RRULE it stands for. */
  rrule?: string
}

export type MeetingProvider = 'manual' | 'google_meet' | 'teams'
export type Meeting = { provider: MeetingProvider; url: string | null }
export type Person = { id: string; name: string }

export type SchedEvent = {
  id: string
  client: Person
  engagement: { id: string; number: number; title: string; unit: string | null } | null
  event_type_id: string | null
  host: Person | null
  title: string
  description: string | null
  client_note: string | null
  mode: 'online' | 'live'
  meeting: Meeting | null
  location: string | null
  time_zone: string
  starts_local: string
  duration_minutes: number
  recurrence: Recurrence | null
  skip_holidays: boolean
  attendees: string[]
  units_per_session: Decimal | null
  unit_price: Decimal | null
  currency: string | null
  sequence: number
  created_at: string
  updated_at: string
}

export type RequestStatus =
  | 'pending'
  | 'proposed'
  | 'approved'
  | 'declined'
  | 'accepted'
  | 'withdrawn'
  | 'expired'

export type SchedRequest = {
  id: string
  occurrence_id: string
  kind: 'cancel' | 'reschedule' | 'booking'
  status: RequestStatus
  late: boolean
  proposed_times: string[]
  staff_proposal: string | null
  note: string | null
  reason: string | null
  created_at: string
  decided_at: string | null
}

export type Conflict = {
  kind: 'event' | 'busy' | 'outside_hours' | 'holiday'
  starts_at: string
  ends_at: string
  occurrence_id?: string
  title?: string
}

export type Occurrence = {
  id: string
  event_id: string
  original_start: string
  starts_at: string
  ends_at: string
  status: Status
  late: boolean
  counts: boolean
  waived: { by: Person; at: string; reason: string | null } | null
  title: string
  location: string | null
  meeting: Meeting | null
  host: Person | null
  client: Person
  engagement: SchedEvent['engagement']
  is_exception: boolean
  sequence: number
  request: SchedRequest | null
  entry_ids: string[]
  invoice: { id: string; number: string | null; status: string } | null
  conflicts?: Conflict[]
  updated_at: string
}

/** A request with the session it is about (`GET /scheduling/requests`). */
export type RequestItem = SchedRequest & {
  occurrence: Pick<Occurrence, 'id' | 'title' | 'starts_at' | 'ends_at' | 'client' | 'host'>
}

export type Busy = { host_id: string; starts_at: string; ends_at: string }

export type EventType = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  mode: 'online' | 'live'
  meeting_provider: MeetingProvider | null
  location: string | null
  unit_price: Decimal | null
  currency: string | null
  host_ids: string[]
  bookable: boolean
  archived_at: string | null
}

export type Settings = {
  booking_mode: 'staff' | 'clients'
  confirmation: 'auto' | 'manual'
  notice_minutes: number
  cutoff_time: string | null
  cutoff_days: number[]
  cutoff_skips_holidays: boolean
  auto_approve_on_time: boolean
  late_cancel_counts: boolean
  no_show_counts: boolean
  late_reschedule_counts: boolean
  client_reminders: number[]
  host_reminders: number[]
  auto_attended_after_hours: number | null
  feed_details: 'full' | 'busy'
  default_location: string | null
}

export type HostProfile = {
  time_zone: string
  bookable: boolean
  color: string | null
  weekly: { day: number; start: string; end: string }[]
  overrides: { date: string; start?: string; end?: string }[]
}

export type Calendars = {
  providers: ('google' | 'microsoft')[]
  data: { id: string; provider: 'google' | 'microsoft'; status: 'active' | 'revoked' | 'error' }[]
}

export type EventInput = {
  client_id: string
  engagement_id: string | null
  event_type_id: string | null
  host_id: string
  title: string
  description: string | null
  client_note: string | null
  mode: 'online' | 'live'
  meeting: Meeting | null
  location: string | null
  time_zone: string
  starts_local: string
  duration_minutes: number
  recurrence: Omit<Recurrence, 'rrule'> | null
  skip_holidays: boolean
  notify: boolean
  /** A one-off on (or a move onto) a day off: the deliberate special request the API asks for. */
  allow_day_off?: boolean
}

export type Scope = 'this' | 'following' | 'all'

/** Why a session of a series does not simply go along when the series moves (the API's preview). */
export type MoveReason =
  | 'started'
  | 'closed'
  | 'exception'
  | 'day_off'
  | 'outside_series'
  | 'request_pending'
  | 'conflict'
  | 'monthly_rule'
export type MoveItem = {
  occurrence_id: string
  starts_at: string
  ends_at: string
  moves_to: string | null
  status: Status
  reason: MoveReason
  /** A warning only: it moves unless kept. */
  moves: boolean
  day_off?: string
}
export type MovePreview = { moving: number; sample: MoveItem[]; items: MoveItem[] }
/** What happens to the sessions a series move lists: kept where they are, cancelled, or (changed on their own) moved too. */
export type MoveChoices = { keep?: string[]; cancel?: string[]; include?: string[] }
type OccurrencePatch = Partial<EventInput> & { scope: Scope } & MoveChoices

export type OccurrenceQuery = {
  from: string
  to: string
  host?: string
  client_id?: string
  engagement_id?: string
  status?: string
  to_mark?: boolean
}

type One<T> = { data: T }
const send = (method: 'POST' | 'PATCH' | 'PUT', json: unknown) => ({ method, json }) as const
const enc = encodeURIComponent
const queryOf = (params: Record<string, string | boolean | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      value === undefined || value === '' || value === false ? [] : [[key, String(value)]],
    ),
  ).toString()

export const schedulingApi = {
  occurrences: async (query: OccurrenceQuery) =>
    (await request<One<Occurrence[]>>(`/scheduling/occurrences?${queryOf(query)}`)).data,
  occurrence: async (id: string) =>
    (await request<One<Occurrence>>(`/scheduling/occurrences/${enc(id)}`)).data,
  event: async (id: string) =>
    (await request<One<SchedEvent>>(`/scheduling/events/${enc(id)}`)).data,
  busy: async (query: { from: string; to: string; host?: string }) =>
    (await request<One<Busy[]>>(`/scheduling/busy?${queryOf(query)}`)).data,
  conflicts: async (query: {
    host_id: string
    starts_at: string
    ends_at: string
    exclude?: string
  }) => (await request<One<Conflict[]>>(`/scheduling/conflicts?${queryOf(query)}`)).data,
  requests: async (query: { status?: string; host?: string } = {}) =>
    (await request<One<RequestItem[]>>(`/scheduling/requests?${queryOf(query)}`)).data,
  settings: async () => (await request<One<Settings>>('/scheduling/settings')).data,
  eventTypes: async () => (await request<One<EventType[]>>('/scheduling/event-types')).data,
  host: async (userId: string) =>
    (await request<One<HostProfile>>(`/scheduling/hosts/${enc(userId)}`)).data,
  calendars: () => request<Calendars>('/scheduling/calendars'),
  createEvent: async (input: EventInput) =>
    (
      await request<One<{ event: SchedEvent; occurrences: Occurrence[]; conflicts: Conflict[] }>>(
        '/scheduling/events',
        send('POST', input),
      )
    ).data,
  patchOccurrence: (id: string, body: OccurrencePatch) =>
    request<One<Occurrence> & { details?: { kept?: number } }>(
      `/scheduling/occurrences/${enc(id)}`,
      send('PATCH', body),
    ),
  /** What a change to this and following, or all sessions would do; changes nothing. */
  previewMove: async (id: string, body: OccurrencePatch) =>
    (
      await request<One<MovePreview>>(
        `/scheduling/occurrences/${enc(id)}`,
        send('PATCH', { ...body, dry_run: true }),
      )
    ).data,
  cancel: async (
    id: string,
    body: { scope: Scope; as: 'on_time' | 'late'; reason?: string; notify?: boolean },
  ) =>
    (
      await request<One<Occurrence>>(
        `/scheduling/occurrences/${enc(id)}/cancel`,
        send('POST', body),
      )
    ).data,
  attendance: async (
    id: string,
    /** Waiving sends `waive` (and a reason) without a status. */
    body: { status?: 'attended' | 'no_show' | 'scheduled'; waive?: boolean; reason?: string },
  ) =>
    (
      await request<One<Occurrence>>(
        `/scheduling/occurrences/${enc(id)}/attendance`,
        send('POST', body),
      )
    ).data,
  approve: async (
    id: string,
    body: { starts_at?: string; as?: 'on_time' | 'late' },
    force = false,
  ) =>
    (
      await request<One<Occurrence>>(
        `/scheduling/requests/${enc(id)}/approve${force ? '?force=true' : ''}`,
        send('POST', body),
      )
    ).data,
  decline: (id: string, body: { reason?: string }) =>
    request<unknown>(`/scheduling/requests/${enc(id)}/decline`, send('POST', body)),
  propose: (id: string, body: { starts_at: string }) =>
    request<unknown>(`/scheduling/requests/${enc(id)}/propose`, send('POST', body)),
}

/** The session's calendar file (`METHOD:PUBLISH`), for a download link. */
export const icsUrl = (occurrenceId: string) =>
  apiUrl(`/scheduling/occurrences/${enc(occurrenceId)}/ics`)

export const schedulingKeys = {
  all: ['scheduling'] as const,
  occurrences: (query: OccurrenceQuery) => ['scheduling', 'occurrences', query] as const,
  occurrence: (id: string) => ['scheduling', 'occurrence', id] as const,
  event: (id: string) => ['scheduling', 'event', id] as const,
  busy: (query: object) => ['scheduling', 'busy', query] as const,
  conflicts: (query: object) => ['scheduling', 'conflicts', query] as const,
  requests: ['scheduling', 'requests'] as const,
  settings: ['scheduling', 'settings'] as const,
  eventTypes: ['scheduling', 'event-types'] as const,
  host: (id: string) => ['scheduling', 'host', id] as const,
  calendars: ['scheduling', 'calendars'] as const,
}

export function useOccurrences(query: OccurrenceQuery, enabled = true) {
  return useQuery({
    queryKey: schedulingKeys.occurrences(query),
    queryFn: () => schedulingApi.occurrences(query),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useBusy(query: { from: string; to: string; host?: string }, enabled = true) {
  return useQuery({
    queryKey: schedulingKeys.busy(query),
    queryFn: () => schedulingApi.busy(query),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Requests waiting for the business (pending, or proposed back to the client). */
export function useRequests(enabled = true) {
  return useQuery({
    queryKey: schedulingKeys.requests,
    queryFn: () => schedulingApi.requests(),
    enabled,
  })
}

export function useOccurrence(id: string | null) {
  return useQuery({
    queryKey: schedulingKeys.occurrence(id ?? ''),
    queryFn: () => schedulingApi.occurrence(id ?? ''),
    enabled: id !== null,
  })
}

export function useSchedEvent(id: string | null) {
  return useQuery({
    queryKey: schedulingKeys.event(id ?? ''),
    queryFn: () => schedulingApi.event(id ?? ''),
    enabled: id !== null,
  })
}

export function useConflicts(
  query: { host_id: string; starts_at: string; ends_at: string; exclude?: string } | null,
) {
  return useQuery({
    queryKey: schedulingKeys.conflicts(query ?? {}),
    queryFn: () => schedulingApi.conflicts(query ?? { host_id: '', starts_at: '', ends_at: '' }),
    enabled: query !== null,
    placeholderData: keepPreviousData,
  })
}

export const useSchedSettings = () =>
  useQuery({ queryKey: schedulingKeys.settings, queryFn: schedulingApi.settings })
export const useEventTypes = () =>
  useQuery({ queryKey: schedulingKeys.eventTypes, queryFn: schedulingApi.eventTypes })
export const useHostProfile = (userId: string | undefined) =>
  useQuery({
    queryKey: schedulingKeys.host(userId ?? ''),
    queryFn: () => schedulingApi.host(userId ?? ''),
    enabled: Boolean(userId),
  })
export const useCalendars = () =>
  useQuery({ queryKey: schedulingKeys.calendars, queryFn: schedulingApi.calendars })

/** A scheduling write: afterwards every scheduling read and the engagements (counted sessions) refetch. */
export function useSchedulingWrite<A, R>(write: (args: A) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: schedulingKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['engagements'] })
    },
  })
}

// ——— Dates and zones. Civil dates are 'YYYY-MM-DD'; a time of day is minutes since midnight. ———

const partsFormat = new Map<string, Intl.DateTimeFormat>()
function formatterFor(zone: string) {
  let format = partsFormat.get(zone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormat.set(zone, format)
  }
  return format
}

/** The wall clock in `zone` at an instant: its civil date and minutes since midnight. */
export function zoned(instant: string | Date, zone: string) {
  const at = typeof instant === 'string' ? new Date(instant) : instant
  const parts: Record<string, string> = {}
  for (const part of formatterFor(zone).formatToParts(at)) parts[part.type] = part.value
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return { date, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

/** How far `zone`'s wall clock is ahead of UTC at an instant, in ms (zones keep whole minutes). */
const offsetAt = (time: number, zone: string) => {
  const { date, minutes } = zoned(new Date(time), zone)
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, minutes) - (time - (time % 60_000))
}

/**
 * The instant of a wall-clock time in `zone`. A time in the spring gap moves forward by the gap (02:30 → 03:30), a
 * time that happens twice is the first (summer-time) one, as the API expands series.
 */
export function instantOf(date: string, minutes: number, zone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const wall = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, minutes)
  // The zone's offsets a day before and after: they differ only around a switch.
  const before = wall - offsetAt(wall - 86_400_000, zone)
  const after = wall - offsetAt(wall + 86_400_000, zone)
  const back = (time: number) => {
    const local = zoned(new Date(time), zone)
    return local.date === date && local.minutes === minutes
  }
  const valid = [before, after].filter(back)
  // Both: the autumn overlap, the earlier wins. Neither: the spring gap, where the offset before the switch moves
  // the time forward by the gap.
  return new Date(valid.length ? Math.min(...valid) : before)
}

export const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10)
}
/** ISO weekday, 1 = Monday. */
export const weekdayOf = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}
export const weekStart = (date: string) => addDays(date, 1 - weekdayOf(date))
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export type View = 'day' | 'week' | 'month'
export const VIEWS: readonly View[] = ['day', 'week', 'month']

/** The civil dates a view shows around `date`: one day, a week from Monday, or the month's weeks. */
export function daysOf(view: View, date: string): string[] {
  if (view === 'day') return [date]
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))
  const first = weekStart(monthStart(date))
  const [y, m] = date.split('-').map(Number)
  const last = addDays(monthStart(date), daysInMonth(y ?? 1970, m ?? 1) - 1)
  const days: string[] = []
  for (let day = first; day <= last || weekdayOf(day) !== 1; day = addDays(day, 1)) days.push(day)
  return days
}

/** The instants a view asks the API for. */
export function rangeOf(view: View, date: string, zone: string) {
  const days = daysOf(view, date)
  const first = days[0] ?? date
  const last = days.at(-1) ?? date
  return {
    from: instantOf(first, 0, zone).toISOString(),
    to: instantOf(addDays(last, 1), 0, zone).toISOString(),
  }
}

/** Where the arrows go: a day, a week or a month on. */
export function step(view: View, date: string, direction: 1 | -1) {
  if (view === 'day') return addDays(date, direction)
  if (view === 'week') return addDays(date, 7 * direction)
  const [y, m] = date.split('-').map(Number)
  const month = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + direction, 1))
  return month.toISOString().slice(0, 10)
}

/** "2026-12-01T09:00" in `zone`, as `starts_local` is written. */
export const localOf = (instant: string | Date, zone: string) => {
  const { date, minutes } = zoned(instant, zone)
  return `${date}T${clock(minutes)}`
}
/** Minutes since midnight as "HH:MM". */
export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export const timeLabel = (instant: string, zone: string) =>
  new Intl.DateTimeFormat(languageTag, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant))
const civil = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(languageTag, { timeZone: 'UTC', ...options }).format(
    new Date(`${date}T12:00:00Z`),
  )
/** "Tue, 1 Dec" */
export const dayLabel = (date: string) =>
  civil(date, { weekday: 'short', day: 'numeric', month: 'short' })
/** "Tuesday, 1 December 2026" */
export const longDayLabel = (date: string) =>
  civil(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
/** "30 Jun 2027" */
export const shortDate = (date: string) =>
  civil(date, { day: 'numeric', month: 'short', year: 'numeric' })
/** A weekday's name in the person's language: "Tue" or "Tuesday". */
export const weekdayName = (day: Weekday, width: 'short' | 'long') =>
  civil(addDays('2026-11-30', WEEKDAYS.indexOf(day)), { weekday: width })

/** The toolbar's title: the day, the week's span or the month. */
export function periodLabel(view: View, date: string) {
  if (view === 'month') return civil(date, { month: 'long', year: 'numeric' })
  if (view === 'day') return longDayLabel(date)
  const days = daysOf('week', date)
  return `${shortDate(days[0] ?? date)} – ${shortDate(days.at(-1) ?? date)}`
}

/** A short name of a zone for labels: "Zurich". */
export const zoneName = (zone: string) => zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone

// ——— Recurrence ———

const ORDINALS = {
  1: 'schedOrdinal1',
  2: 'schedOrdinal2',
  3: 'schedOrdinal3',
  4: 'schedOrdinal4',
  '-1': 'schedOrdinalLast',
} as const

/** The civil dates a rule makes from `start` (its first date), up to `max` (no holidays left out). */
export function expandDates(rule: Recurrence, start: string, max = 520): string[] {
  const until = rule.until ?? '9999-12-31'
  const limit = Math.min(rule.count ?? max, max)
  const dates: string[] = []
  const push = (date: string) => {
    if (date >= start && date <= until && dates.length < limit) dates.push(date)
  }
  if (rule.freq === 'weekly') {
    const days = (rule.by_day?.length ? rule.by_day : [WEEKDAYS[weekdayOf(start) - 1] ?? 'MO'])
      .map((day) => WEEKDAYS.indexOf(day))
      .toSorted((a, b) => a - b)
    for (
      let week = weekStart(start);
      week <= until && dates.length < limit;
      week = addDays(week, 7 * rule.interval)
    )
      for (const day of days) push(addDays(week, day))
    return dates
  }
  const [y, m] = start.split('-').map(Number)
  for (let index = 0; dates.length < limit; index += rule.interval) {
    const month = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + index, 1))
    const first = month.toISOString().slice(0, 10)
    if (first > until) break
    const length = daysInMonth(month.getUTCFullYear(), month.getUTCMonth() + 1)
    if (rule.by_set_pos) {
      const wanted = WEEKDAYS.indexOf(rule.by_set_pos.day) + 1
      const matching = Array.from({ length }, (_, i) => addDays(first, i)).filter(
        (date) => weekdayOf(date) === wanted,
      )
      const pick = rule.by_set_pos.pos === -1 ? matching.at(-1) : matching[rule.by_set_pos.pos - 1]
      if (pick) push(pick)
    } else {
      const day = rule.by_month_day ?? Number(start.slice(8, 10))
      // Months without that day are skipped; -1 is the last day.
      if (day === -1) push(addDays(first, length - 1))
      else if (day <= length) push(addDays(first, day - 1))
    }
    if (index > 12 * 100) break
  }
  return dates
}

const join = (names: string[]) =>
  new Intl.ListFormat(languageTag, { style: 'long', type: 'conjunction' }).format(names)

/** "Every 2 weeks on Tue and Thu until 30 Jun 2027, 18 sessions", from a rule and its first date. */
export function recurrenceSummary(rule: Recurrence, start: string): string {
  let text: string
  if (rule.freq === 'weekly') {
    const days = (rule.by_day?.length ? rule.by_day : [WEEKDAYS[weekdayOf(start) - 1] ?? 'MO'])
      .slice()
      .toSorted((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
      .map((day) => weekdayName(day, 'short'))
    text = translate('schedEveryWeeksOn', { count: rule.interval, days: join(days) })
  } else if (rule.by_set_pos) {
    text = translate('schedEveryMonthsOnThe', {
      count: rule.interval,
      ordinal: translate(ORDINALS[rule.by_set_pos.pos]),
      day: weekdayName(rule.by_set_pos.day, 'long'),
    })
  } else {
    const day = rule.by_month_day ?? Number(start.slice(8, 10))
    text =
      day === -1
        ? translate('schedEveryMonthsOnLastDay', { count: rule.interval })
        : translate('schedEveryMonthsOnDay', { count: rule.interval, day })
  }
  if (rule.until) {
    const sessions = expandDates(rule, start).length
    return translate('schedSummaryUntil', {
      rule: text,
      date: shortDate(rule.until),
      count: sessions,
    })
  }
  if (rule.count) return translate('schedSummaryCount', { rule: text, count: rule.count })
  return text
}

/** Units one session uses on an engagement by default: hours for `hour`, an 8-hour day for `day`, else 1. */
export function defaultUnits(unit: string | null | undefined, minutes: number): string {
  if (unit === 'hour') return (Math.round((minutes / 60) * 1000) / 1000).toString()
  if (unit === 'day') return (Math.round((minutes / 480) * 1000) / 1000).toString()
  return '1'
}

// ——— Status and presentation ———

export const STATUS_LABEL: Record<Status, string> = {
  requested: translate('schedStatusRequested'),
  scheduled: translate('schedStatusScheduled'),
  rescheduled: translate('schedStatusRescheduled'),
  attended: translate('schedStatusAttended'),
  no_show: translate('schedStatusNoShow'),
  cancelled_on_time: translate('schedStatusCancelled'),
  cancelled_late: translate('schedStatusCancelledLate'),
  declined: translate('schedStatusDeclined'),
}
export const STATUS_TONE = {
  requested: 'amber',
  scheduled: 'blue',
  rescheduled: 'blue',
  attended: 'green',
  no_show: 'red',
  cancelled_on_time: 'neutral',
  cancelled_late: 'amber',
  declined: 'neutral',
} as const satisfies Record<Status, string>

// One theme colour per host, picked from the host's id so a host keeps their colour everywhere.
const HOST_COLORS = [
  'var(--color-brand-solid)',
  'var(--color-success-solid)',
  'var(--color-violet-solid)',
  'var(--color-warning-solid)',
  'var(--color-info-solid)',
  'var(--color-chart-1)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]
const NO_HOST = 'var(--color-muted-foreground)'
export function hostColor(id: string | null | undefined) {
  if (!id) return NO_HOST
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return HOST_COLORS[hash % HOST_COLORS.length] ?? NO_HOST
}
/** A host's colour mixed into transparency, for a block's fill. */
export const hostTint = (id: string | null | undefined, percent: number) =>
  `color-mix(in oklab, ${hostColor(id)} ${percent}%, transparent)`

/** Past sessions still open: staff mark them attended or a no-show. */
export const needsMarking = (occurrence: Occurrence, now = Date.now()) =>
  isOpen(occurrence.status) && Date.parse(occurrence.ends_at) < now

/** The cancellation the policy suggests: late once the notice has run out (the cut-off is the API's to apply). */
export function defaultCancelAs(
  occurrence: Pick<Occurrence, 'starts_at'>,
  settings: Pick<Settings, 'notice_minutes'> | undefined,
  now = Date.now(),
): 'on_time' | 'late' {
  const notice = (settings?.notice_minutes ?? 1440) * 60_000
  return now > Date.parse(occurrence.starts_at) - notice ? 'late' : 'on_time'
}

const csvCell = (value: string) =>
  /[",\n;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

/** The list view's sessions as CSV, times in `zone`. */
export function occurrencesCsv(rows: Occurrence[], zone: string) {
  const header = [
    translate('date'),
    translate('schedStart'),
    translate('schedEnd'),
    translate('title'),
    translate('client'),
    translate('schedHost'),
    translate('status'),
    translate('schedEngagement'),
  ]
  const lines = rows.map((row) => {
    const start = zoned(row.starts_at, zone)
    return [
      start.date,
      clock(start.minutes),
      clock(zoned(row.ends_at, zone).minutes),
      row.title,
      row.client.name,
      row.host?.name ?? '',
      STATUS_LABEL[row.status],
      row.engagement ? `#${row.engagement.number} ${row.engagement.title}` : '',
    ]
      .map(csvCell)
      .join(',')
  })
  return [header.map(csvCell).join(','), ...lines].join('\n')
}

/**
 * What a refused change of a session says where no form shows its fields (a drag, Alt+arrows, the series dialog):
 * the server's words for each field rather than "check the highlighted fields".
 */
export function changeErrorMessage(error: unknown) {
  const fields = error instanceof ApiError ? error.details.fields : undefined
  const words =
    fields && typeof fields === 'object'
      ? Object.values(fields).filter((text): text is string => typeof text === 'string')
      : []
  return words.length > 0 ? words.join(' ') : errorMessage(error)
}
