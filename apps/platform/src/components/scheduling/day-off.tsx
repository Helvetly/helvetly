'use client'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import { dayLabel, zoned, type EventInput, type Occurrence } from '@/lib/scheduling'
import { useHolidays } from '@/lib/scheduling-settings'

/** Days off: a soft amber tint with lines the other way from the past hatch, so the two never read alike. */
export const DAY_OFF_TINT =
  'bg-warning-surface/60 bg-[repeating-linear-gradient(45deg,transparent_0_8px,color-mix(in_oklch,var(--warning-solid)_14%,transparent)_8px_9px)]'

export type DaysOff = ReadonlyMap<string, string>

/** The workspace's days off, date → name; empty until they load (the API still refuses one without the flag). */
export function useDaysOff(): DaysOff {
  return new Map((useHolidays().data ?? []).map((day) => [day.date, day.name]))
}

/** "Day off: no bookings (Christmas Day)", for a tooltip or an accessible name. */
export const dayOffHint = (name: string) => `${translate('schedDayOffHint')} (${name})`

/** The new-session form's warning: a session on a day off is a special request, confirmed before it can be scheduled. */
export function DayOffWarning({
  date,
  name,
  confirmed,
  onConfirm,
}: {
  date: string
  name: string
  confirmed: boolean
  onConfirm: (confirmed: boolean) => void
}) {
  return (
    <div
      data-day-off-warning
      className="mb-5 grid gap-2 rounded-lg bg-warning-surface px-3 py-2.5 text-body-sm text-warning"
    >
      <p className="flex gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {translate('schedDayOffWarning', { day: dayLabel(date), name })}
      </p>
      <label className="flex w-fit items-center gap-2 pl-6 text-foreground">
        <Checkbox checked={confirmed} onCheckedChange={(checked) => onConfirm(checked === true)} />
        {translate('schedDayOffConfirm')}
      </label>
    </div>
  )
}

type Move = (
  occurrence: Occurrence,
  startsAt: Date,
  endsAt: Date,
  extra?: Partial<EventInput>,
) => unknown

/** Wraps a calendar move: onto another day that is a day off it asks first, then sends `allow_day_off`. */
export function useDayOffMove(daysOff: DaysOff, zone: string, move: Move) {
  const [asking, setAsking] = useState<{
    occurrence: Occurrence
    startsAt: Date
    endsAt: Date
    date: string
    name: string
  } | null>(null)
  const guarded = (occurrence: Occurrence, startsAt: Date, endsAt: Date) => {
    const date = zoned(startsAt, zone).date
    const name = daysOff.get(date)
    if (name && date !== zoned(occurrence.starts_at, zone).date)
      setAsking({ occurrence, startsAt, endsAt, date, name })
    else void move(occurrence, startsAt, endsAt)
  }
  const dialog = asking && (
    <ConfirmDialog
      title={translate('schedDayOffMoveTitle')}
      body={translate('schedDayOffMoveText', { day: dayLabel(asking.date), name: asking.name })}
      confirmLabel={translate('schedDayOffMove')}
      cancelLabel={translate('cancel')}
      tone="default"
      onDecide={(approved) => {
        setAsking(null)
        if (approved)
          void move(asking.occurrence, asking.startsAt, asking.endsAt, { allow_day_off: true })
      }}
    />
  )
  return { move: guarded, dialog }
}

/** The list's day groups with each day off added (a day off without sessions too), by date. */
export function withDaysOff<T>(groups: Map<string, T[]>, daysOff: DaysOff | undefined) {
  const all = new Map(groups)
  for (const date of daysOff?.keys() ?? []) if (!all.has(date)) all.set(date, [])
  return [...all.entries()].toSorted(([a], [b]) => a.localeCompare(b))
}

/** "Day off · Christmas Day" under a date in the list. */
export function DayOffLine({ name }: { name: string }) {
  return (
    <p
      data-day-off-line
      title={dayOffHint(name)}
      className="px-1 text-body-sm text-muted-foreground"
    >
      {translate('schedDayOffLine', { name })}
    </p>
  )
}
