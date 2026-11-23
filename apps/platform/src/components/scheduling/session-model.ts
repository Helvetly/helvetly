import { translate } from '@/lib/i18n'
import {
  addDays,
  clock,
  instantOf,
  minutesOf,
  weekdayOf,
  WEEKDAYS,
  zoned,
  type EventInput,
  type MeetingProvider,
  type Occurrence,
  type Person,
  type Recurrence,
  type SchedEvent,
  type Weekday,
} from '@/lib/scheduling'
// The session drawer's form: its values, checks and the API's EventInput they become.
import type { EventType } from '@/lib/scheduling-settings'

export type Values = {
  client: Person | null
  engagement_id: string
  event_type_id: string
  host_id: string
  title: string
  /** The title is the form's own (empty, or from the engagement or event type), so a pick may replace it. */
  title_auto: boolean
  date: string
  time: string
  duration: string
  repeat: 'none' | 'weekly' | 'monthly'
  interval: string
  by_day: Weekday[]
  monthly: 'day' | 'weekday'
  ends: 'never' | 'until' | 'count'
  until: string
  count: string
  skip_holidays: boolean
  mode: 'online' | 'live'
  provider: MeetingProvider
  meeting_url: string
  location: string
  client_note: string
  description: string
  notify: boolean
}
export type Errors = Partial<Record<keyof Values, string>>

export const weekdayOfDate = (date: string): Weekday => WEEKDAYS[weekdayOf(date) - 1] ?? 'MO'

/** A new session: the slot clicked (or the next full hour), the caller as host, one hour, live at the default place. */
export function blankValues(start: {
  date: string
  minutes: number
  hostId: string
  location?: string | null
  client?: Person | null
  engagementId?: string
  title?: string
}): Values {
  return {
    client: start.client ?? null,
    engagement_id: start.engagementId ?? '',
    event_type_id: '',
    host_id: start.hostId,
    title: start.title ?? '',
    title_auto: true,
    date: start.date,
    time: clock(start.minutes),
    duration: '60',
    repeat: 'none',
    interval: '1',
    by_day: [weekdayOfDate(start.date)],
    monthly: 'day',
    ends: 'never',
    until: addDays(start.date, 90),
    count: '10',
    skip_holidays: true,
    mode: 'live',
    provider: 'manual',
    meeting_url: '',
    location: start.location ?? '',
    client_note: '',
    description: '',
    notify: true,
  }
}

/** The form for changing one session of `event`, at the session's own time in the event's zone. */
export function valuesFrom(occurrence: Occurrence, event: SchedEvent): Values {
  const start = zoned(occurrence.starts_at, event.time_zone)
  const rule = event.recurrence
  return {
    client: occurrence.client,
    engagement_id: occurrence.engagement?.id ?? '',
    event_type_id: event.event_type_id ?? '',
    host_id: occurrence.host?.id ?? '',
    title: occurrence.title,
    title_auto: false,
    date: start.date,
    time: clock(start.minutes),
    duration: String(
      Math.round((Date.parse(occurrence.ends_at) - Date.parse(occurrence.starts_at)) / 60_000),
    ),
    repeat: rule?.freq ?? 'none',
    interval: String(rule?.interval ?? 1),
    by_day: rule?.by_day?.length ? rule.by_day : [weekdayOfDate(start.date)],
    monthly: rule?.by_set_pos ? 'weekday' : 'day',
    ends: rule?.until ? 'until' : rule?.count ? 'count' : 'never',
    until: rule?.until ?? addDays(start.date, 90),
    count: String(rule?.count ?? 10),
    skip_holidays: event.skip_holidays,
    mode: event.mode,
    provider: occurrence.meeting?.provider ?? event.meeting?.provider ?? 'manual',
    meeting_url: occurrence.meeting?.url ?? event.meeting?.url ?? '',
    location: occurrence.location ?? event.location ?? '',
    client_note: event.client_note ?? '',
    description: event.description ?? '',
    notify: true,
  }
}

/** The weekday of `date` within its month: 1–4, or -1 for the last one (the 5th is always the last). */
export function setPosOf(date: string): 1 | 2 | 3 | 4 | -1 {
  const day = Number(date.slice(8, 10))
  const next = addDays(date, 7)
  if (next.slice(5, 7) !== date.slice(5, 7)) return -1
  const index = Math.ceil(day / 7)
  return index === 1 || index === 2 || index === 3 || index === 4 ? index : -1
}

/** The repeat menu's entries: the common rules for the start date, or the full panel. */
export type RepeatPreset = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom'

/** The menu entry the values are; any other rule (more days, an end, day of month…) is custom. */
export function presetOf(values: Values): RepeatPreset {
  if (values.repeat === 'none') return 'none'
  if (values.ends !== 'never') return 'custom'
  if (values.repeat === 'monthly')
    return values.monthly === 'weekday' && values.interval === '1' ? 'monthly' : 'custom'
  if (values.by_day.length !== 1 || values.by_day[0] !== weekdayOfDate(values.date)) return 'custom'
  return values.interval === '1' ? 'weekly' : values.interval === '2' ? 'biweekly' : 'custom'
}

/** The values a menu entry sets; custom keeps the rule there is, or starts weekly on the start's day. */
export function presetValues(preset: RepeatPreset, values: Values): Partial<Values> {
  const by_day = [weekdayOfDate(values.date)]
  if (preset === 'none') return { repeat: 'none' }
  if (preset === 'weekly') return { repeat: 'weekly', interval: '1', by_day, ends: 'never' }
  if (preset === 'biweekly') return { repeat: 'weekly', interval: '2', by_day, ends: 'never' }
  if (preset === 'monthly')
    return { repeat: 'monthly', interval: '1', monthly: 'weekday', ends: 'never' }
  return values.repeat === 'none' ? { repeat: 'weekly', interval: '1', by_day } : {}
}

/** A new start date; a weekly rule on the old date's day moves to the new one, as the menu names it. */
export function dateChange(values: Values, date: string): Partial<Values> {
  const preset = presetOf(values)
  return (preset === 'weekly' || preset === 'biweekly') && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? { date, by_day: [weekdayOfDate(date)] }
    : { date }
}

/** Picking an engagement or event type names the session after it, until a title is typed. */
export const autoTitle = (values: Values, name: string): Partial<Values> =>
  values.title_auto && name ? { title: name } : {}

/** Picking an event type: its length and place, and its name until a title is typed. */
export const eventTypeValues = (
  values: Values,
  type: Pick<
    EventType,
    'id' | 'name' | 'duration_minutes' | 'mode' | 'meeting_provider' | 'location'
  >,
): Partial<Values> => ({
  event_type_id: type.id,
  duration: String(type.duration_minutes),
  mode: type.mode,
  provider: type.meeting_provider ?? values.provider,
  location: type.location ?? values.location,
  ...autoTitle(values, type.name),
})

/** The duration is asked for unless it is the chosen event type's own length (then the summary names it). */
export const asksDuration = (
  values: Values,
  type: Pick<EventType, 'duration_minutes'> | undefined,
  overriding: boolean,
) => overriding || !type || values.duration !== String(type.duration_minutes)

/** A typed title stays; clearing it lets the next pick name the session again. */
export const typedTitle = (title: string): Partial<Values> => ({
  title,
  title_auto: title.trim() === '',
})

export function recurrenceOf(values: Values): Omit<Recurrence, 'rrule'> | null {
  if (values.repeat === 'none') return null
  const ends =
    values.ends === 'until'
      ? { until: values.until }
      : values.ends === 'count'
        ? { count: Number(values.count) }
        : {}
  const interval = Number(values.interval)
  if (values.repeat === 'weekly')
    return { freq: 'weekly', interval, by_day: values.by_day, ...ends }
  return values.monthly === 'weekday'
    ? {
        freq: 'monthly',
        interval,
        by_set_pos: { pos: setPosOf(values.date), day: weekdayOfDate(values.date) },
        ...ends,
      }
    : { freq: 'monthly', interval, by_month_day: Number(values.date.slice(8, 10)), ...ends }
}

const whole = (text: string, min: number, max: number) =>
  /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max

/** The checks the API makes, so most mistakes show before a round trip. */
export function validate(values: Values): Errors {
  const errors: Errors = {}
  if (!values.client) errors.client = translate('schedChooseClient')
  if (!values.host_id) errors.host_id = translate('schedChooseHost')
  if (!values.title.trim()) errors.title = translate('schedEnterTitle')
  else if (values.title.length > 200) errors.title = translate('schedTitleTooLong')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errors.date = translate('schedEnterDate')
  if (!/^\d{2}:\d{2}$/.test(values.time)) errors.time = translate('schedEnterTime')
  if (!whole(values.duration, 5, 720)) errors.duration = translate('schedDurationRange')
  if (values.repeat !== 'none') {
    if (!whole(values.interval, 1, 12)) errors.interval = translate('schedIntervalRange')
    if (values.repeat === 'weekly' && values.by_day.length === 0)
      errors.by_day = translate('schedPickDays')
    if (values.ends === 'until' && !(values.until >= values.date))
      errors.until = translate('schedUntilAfterStart')
    if (values.ends === 'count' && !whole(values.count, 1, 520))
      errors.count = translate('schedCountRange')
  }
  if (
    values.mode === 'online' &&
    values.provider === 'manual' &&
    values.meeting_url &&
    !/^https:\/\/\S+$/.test(values.meeting_url)
  )
    errors.meeting_url = translate('schedMeetingUrl')
  if (values.client_note.length > 2000) errors.client_note = translate('schedTooLong')
  if (values.description.length > 4000) errors.description = translate('schedTooLong')
  return errors
}

const orNull = (text: string) => (text.trim() ? text.trim() : null)

export function toInput(values: Values, zone: string): EventInput {
  return {
    client_id: values.client?.id ?? '',
    engagement_id: orNull(values.engagement_id),
    event_type_id: orNull(values.event_type_id),
    host_id: values.host_id,
    title: values.title.trim(),
    description: orNull(values.description),
    client_note: orNull(values.client_note),
    mode: values.mode,
    meeting:
      values.mode === 'online'
        ? {
            provider: values.provider,
            url: values.provider === 'manual' ? orNull(values.meeting_url) : null,
          }
        : null,
    location: values.mode === 'live' ? orNull(values.location) : null,
    time_zone: zone,
    starts_local: `${values.date}T${values.time}`,
    duration_minutes: Number(values.duration),
    recurrence: recurrenceOf(values),
    skip_holidays: values.skip_holidays,
    notify: values.notify,
  }
}

/** What an edit changes, as the PATCH body; `ruleChanged` when the series' rule or slot moves too. */
export function changesOf(before: Values, after: Values, zone: string) {
  const a = toInput(before, zone)
  const b = toInput(after, zone)
  const old = new Map(Object.entries(a))
  const body: Partial<EventInput> = Object.fromEntries(
    Object.entries(b).filter(
      ([key, value]) => key !== 'notify' && JSON.stringify(old.get(key)) !== JSON.stringify(value),
    ),
  )
  body.notify = after.notify
  const ruleChanged =
    JSON.stringify(a.recurrence) !== JSON.stringify(b.recurrence) ||
    a.skip_holidays !== b.skip_holidays
  return { body, ruleChanged, empty: Object.keys(body).length === 1 }
}

/** The instants of the form's slot, for the conflict check; null while the date or time is incomplete. */
export function slotOf(values: Values, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !/^\d{2}:\d{2}$/.test(values.time)) return null
  if (!whole(values.duration, 5, 720)) return null
  const start = instantOf(values.date, minutesOf(values.time), zone)
  return {
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + Number(values.duration) * 60_000).toISOString(),
  }
}
