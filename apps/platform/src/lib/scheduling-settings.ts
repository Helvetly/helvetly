'use client'
// Scheduling settings, holidays, event types, host hours, calendar connections and the iCal feed, typed by hand from
// the scheduling contract. Go serves them; the handlers in src/mocks/scheduling-settings.ts are a test-only fake.
import { languageTag } from '@helvetly/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'

type One<T> = { data: T }
const send = (method: 'POST' | 'PATCH' | 'PUT', json: unknown) => ({ method, json }) as const

export type BookingMode = 'staff' | 'clients'
export type Confirmation = 'auto' | 'manual'
export type FeedDetails = 'full' | 'busy'

export type SchedulingSettings = {
  booking_mode: BookingMode
  confirmation: Confirmation
  notice_minutes: number
  /** `HH:MM` in the workspace zone, or null: no cut-off. */
  cutoff_time: string | null
  /** ISO weekdays, 1 = Monday. */
  cutoff_days: number[]
  cutoff_skips_holidays: boolean
  auto_approve_on_time: boolean
  late_cancel_counts: boolean
  no_show_counts: boolean
  late_reschedule_counts: boolean
  /** Minutes before the start. */
  client_reminders: number[]
  host_reminders: number[]
  auto_attended_after_hours: number | null
  feed_details: FeedDetails
  default_location: string | null
}

type SchedulingSettingsResponse = SchedulingSettings & { policy_text?: string }

export type Holiday = { date: string; name: string }

export type Mode = 'online' | 'live'
export type MeetingProvider = 'manual' | 'google_meet' | 'teams'

export type EventType = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  mode: Mode
  meeting_provider: MeetingProvider | null
  location: string | null
  product_id: string | null
  unit_price: string | null
  currency: string | null
  /** Empty: every host with availability. */
  host_ids: string[]
  buffer_before: number
  buffer_after: number
  min_notice_minutes: number
  max_horizon_days: number
  slot_step_minutes: number | null
  bookable: boolean
  color: string | null
  archived_at: string | null
}
export type EventTypeInput = Omit<EventType, 'id' | 'archived_at'>

export type Window = { day: number; start: string; end: string }
export type Override = { date: string; start?: string | null; end?: string | null }
export type HostHours = {
  time_zone: string | null
  bookable: boolean
  color: string | null
  weekly: Window[]
  overrides: Override[]
}

type HostHoursResponse = HostHours & { user_id: string }

export type Provider = 'google' | 'microsoft'
export type CalendarInfo = { id: string; name: string; primary: boolean }
export type Connection = {
  id: string
  provider: Provider
  account_email: string
  status: 'active' | 'revoked' | 'error'
  push_calendar_id: string | null
  busy_calendar_ids: string[]
  calendars: CalendarInfo[]
  last_synced_at: string | null
  error: string | null
}
export type Connections = { providers: Provider[]; data: Connection[] }
export type Feed = { url: string; created_at: string; last_fetched_at: string | null }

export const schedulingKeys = {
  settings: ['scheduling', 'settings'] as const,
  holidays: ['scheduling', 'holidays'] as const,
  eventTypes: ['scheduling', 'event-types'] as const,
  hours: (userId: string) => ['scheduling', 'hosts', userId] as const,
  calendars: ['scheduling', 'calendars'] as const,
  feed: ['scheduling', 'feed'] as const,
}

const eventTypePath = (id: string) => `/scheduling/event-types/${encodeURIComponent(id)}`
const calendarPath = (id: string) => `/scheduling/calendars/${encodeURIComponent(id)}`

export const schedulingApi = {
  settings: async () =>
    (await request<One<SchedulingSettingsResponse>>('/scheduling/settings')).data,
  saveSettings: async (settings: SchedulingSettingsResponse) => {
    const input = { ...settings }
    delete input.policy_text
    return (
      await request<One<SchedulingSettingsResponse>>('/scheduling/settings', send('PUT', input))
    ).data
  },
  holidays: async () => (await request<One<{ days: Holiday[] }>>('/scheduling/holidays')).data.days,
  saveHolidays: async (days: Holiday[]) =>
    (await request<One<{ days: Holiday[] }>>('/scheduling/holidays', send('PUT', { days }))).data
      .days,
  /** Suggestions, not saved: the country's public holidays and the canton's (Switzerland). */
  suggestHolidays: async (year: number, canton: string) =>
    (
      await request<One<{ days: Holiday[] }>>(
        `/scheduling/holidays?suggest=CH&year=${year}${canton ? `&canton=${canton}` : ''}`,
      )
    ).data.days,
  eventTypes: async () => (await request<One<EventType[]>>('/scheduling/event-types')).data,
  createEventType: async (input: EventTypeInput) =>
    (await request<One<EventType>>('/scheduling/event-types', send('POST', input))).data,
  updateEventType: async ({ id, ...input }: EventTypeInput & { id: string }) =>
    (await request<One<EventType>>(eventTypePath(id), send('PATCH', input))).data,
  deleteEventType: (id: string) => request<void>(eventTypePath(id), { method: 'DELETE' }),
  hours: async (userId: string) =>
    (await request<One<HostHoursResponse>>(`/scheduling/hosts/${encodeURIComponent(userId)}`)).data,
  saveHours: async ({
    userId,
    time_zone,
    bookable,
    color,
    weekly,
    overrides,
  }: HostHours & { userId: string }) =>
    (
      await request<One<HostHoursResponse>>(
        `/scheduling/hosts/${encodeURIComponent(userId)}`,
        send('PUT', { time_zone, bookable, color, weekly, overrides }),
      )
    ).data,
  calendars: () => request<Connections>('/scheduling/calendars'),
  patchCalendar: async ({
    id,
    ...input
  }: {
    id: string
    push_calendar_id?: string | null
    busy_calendar_ids?: string[]
  }) => (await request<One<Connection>>(calendarPath(id), send('PATCH', input))).data,
  syncCalendar: (id: string) => request<void>(`${calendarPath(id)}/sync`, { method: 'POST' }),
  disconnect: ({ id, keepEvents }: { id: string; keepEvents: boolean }) =>
    request<void>(`${calendarPath(id)}${keepEvents ? '?keep_events=true' : ''}`, {
      method: 'DELETE',
    }),
  feed: async () => (await request<One<Feed | null>>('/scheduling/feed')).data,
  makeFeed: async () => (await request<One<Feed>>('/scheduling/feed', { method: 'POST' })).data,
  removeFeed: () => request<void>('/scheduling/feed', { method: 'DELETE' }),
}

export const useSchedulingSettings = () =>
  useQuery({ queryKey: schedulingKeys.settings, queryFn: schedulingApi.settings })
export const useHolidays = () =>
  useQuery({ queryKey: schedulingKeys.holidays, queryFn: schedulingApi.holidays })
export const useEventTypes = () =>
  useQuery({ queryKey: schedulingKeys.eventTypes, queryFn: schedulingApi.eventTypes })
export const useHostHours = (userId: string) =>
  useQuery({ queryKey: schedulingKeys.hours(userId), queryFn: () => schedulingApi.hours(userId) })
export const useCalendars = () =>
  useQuery({ queryKey: schedulingKeys.calendars, queryFn: schedulingApi.calendars })
export const useFeed = () =>
  useQuery({ queryKey: schedulingKeys.feed, queryFn: schedulingApi.feed })

/** A mutation that puts its answer into one query, or refetches it when the answer is not the whole record. */
function useWrite<Input, Output>(
  write: (input: Input) => Promise<Output>,
  key: readonly unknown[],
  put?: (answer: Output) => unknown,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onSuccess: (answer) => {
      if (put) queryClient.setQueryData(key, put(answer))
      else void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export const useSaveSchedulingSettings = () =>
  useWrite(schedulingApi.saveSettings, schedulingKeys.settings, (saved) => saved)
export const useSaveHolidays = () =>
  useWrite(schedulingApi.saveHolidays, schedulingKeys.holidays, (days) => days)
export const useCreateEventType = () =>
  useWrite(schedulingApi.createEventType, schedulingKeys.eventTypes)
export const useUpdateEventType = () =>
  useWrite(schedulingApi.updateEventType, schedulingKeys.eventTypes)
export const useDeleteEventType = () =>
  useWrite(schedulingApi.deleteEventType, schedulingKeys.eventTypes)
export const usePatchCalendar = () =>
  useWrite(schedulingApi.patchCalendar, schedulingKeys.calendars)
export const useSyncCalendar = () => useWrite(schedulingApi.syncCalendar, schedulingKeys.calendars)
export const useDisconnectCalendar = () =>
  useWrite(schedulingApi.disconnect, schedulingKeys.calendars)
export const useMakeFeed = () => useWrite(schedulingApi.makeFeed, schedulingKeys.feed, (f) => f)
export const useRemoveFeed = () =>
  useWrite(schedulingApi.removeFeed, schedulingKeys.feed, () => null)

export function useSaveHours(userId: string) {
  return useWrite(schedulingApi.saveHours, schedulingKeys.hours(userId), (saved) => saved)
}

// Pure helpers

export const DEFAULT_SETTINGS: SchedulingSettings = {
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
  default_location: null,
}

export const MAX_NOTICE_MINUTES = 20160

/** A weekday (1 = Monday) in the interface language: "Mon". */
export function weekdayName(day: number, width: 'short' | 'long' = 'short'): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(languageTag, { weekday: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, day)),
  )
}

/** "1 day", "2 h 30 min", "45 min": a lead time or a duration in the words people use. */
export function durationText(minutes: number): string {
  if (minutes <= 0) return translate('schedulingSettingsNoNotice')
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const parts = [
    days > 0 && translate('schedulingSettingsDays', { count: days }),
    hours > 0 && translate('schedulingSettingsHours', { count: hours }),
    rest > 0 && translate('schedulingSettingsMinutes', { count: rest }),
  ].filter(Boolean)
  return parts.join(' ')
}

export const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const
export type DurationUnit = keyof typeof UNIT_MINUTES

/** A preset as people say it: "1 week", "3 days", "48 hours" (up to two days in hours), else durationText. */
export function presetText(minutes: number): string {
  if (minutes > 0 && minutes % 10080 === 0)
    return translate('schedulingSettingsWeeks', { count: minutes / 10080 })
  if (minutes > 0 && minutes <= 2880 && minutes % 60 === 0)
    return translate('schedulingSettingsHours', { count: minutes / 60 })
  return durationText(minutes)
}

/** Minutes as an amount of the largest of `units` that holds them whole: 2880 → 2 days; 90 → 90 minutes. */
export function splitDuration(
  minutes: number,
  units: readonly DurationUnit[],
): { amount: number; unit: DurationUnit } {
  const fits = units.filter((unit) => minutes % UNIT_MINUTES[unit] === 0)
  const unit =
    fits.toSorted((a, b) => UNIT_MINUTES[b] - UNIT_MINUTES[a])[0] ??
    units.toSorted((a, b) => UNIT_MINUTES[a] - UNIT_MINUTES[b])[0] ??
    'minutes'
  return { amount: minutes / UNIT_MINUTES[unit], unit }
}

/** What a custom amount means in minutes; empty or not a number is NaN, which validation refuses. */
export function durationMinutes(amount: string, unit: DurationUnit): number {
  const text = amount.trim().replace(',', '.')
  return text === '' ? NaN : Math.round(Number(text) * UNIT_MINUTES[unit])
}

/** A list of weekdays as a sentence part: "Mon–Fri", "Mon, Wed and Fri". */
export function daysText(days: readonly number[]): string {
  const sorted = [...new Set(days)].toSorted((a, b) => a - b)
  const first = sorted[0]
  const last = sorted.at(-1)
  if (
    first !== undefined &&
    last !== undefined &&
    sorted.length > 2 &&
    last - first + 1 === sorted.length
  )
    return `${weekdayName(first)}–${weekdayName(last)}`
  return new Intl.ListFormat(languageTag, { type: 'conjunction' }).format(
    sorted.map((d) => weekdayName(d)),
  )
}

/** The cancellation policy as one sentence, for the live example under its fields. */
export function policySentence(settings: SchedulingSettings): string {
  const notice = durationText(settings.notice_minutes)
  const cutoff =
    settings.cutoff_time && settings.cutoff_days.length > 0
      ? translate('schedulingSettingsPolicyCutoff', {
          time: settings.cutoff_time,
          days: daysText(settings.cutoff_days),
          holidays: settings.cutoff_skips_holidays ? 'yes' : 'no',
        })
      : ''
  const free =
    settings.notice_minutes <= 0 && !cutoff
      ? translate('schedulingSettingsPolicyAnytime')
      : translate('schedulingSettingsPolicyFree', { notice })
  const late = settings.late_cancel_counts
    ? translate('schedulingSettingsPolicyLateCounts')
    : translate('schedulingSettingsPolicyLateFree')
  return [free, cutoff, late].filter(Boolean).join(' ')
}

/** "HH:MM" must be a real wall-clock time. */
export const isClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

/** A reminder lead time such as "1d", "90m", "2h" or a bare number of minutes → minutes, or null. */
export function parseLeadTime(text: string): number | null {
  const match = /^\s*(\d+)\s*(m|min|h|d)?\s*$/i.exec(text)
  if (!match) return null
  const amount = Number(match[1])
  const unit = (match[2] ?? 'm').toLowerCase()
  const minutes = unit === 'd' ? amount * 1440 : unit === 'h' ? amount * 60 : amount
  return minutes > 0 && minutes <= MAX_NOTICE_MINUTES ? minutes : null
}

/** The Swiss cantons, for the holiday suggestions. */
export const CANTONS = [
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
] as const

/** Time of day windows of one weekday, sorted; a window must start before it ends and not overlap the next. */
export function windowProblem(windows: readonly Window[]): string | null {
  const sorted = windows.toSorted((a, b) => a.day - b.day || a.start.localeCompare(b.start))
  for (const [i, w] of sorted.entries()) {
    if (!isClock(w.start) || !isClock(w.end) || w.start >= w.end)
      return translate('schedulingSettingsWindowOrder')
    const next = sorted[i + 1]
    if (next && next.day === w.day && next.start < w.end)
      return translate('schedulingSettingsWindowOverlap')
  }
  return null
}
