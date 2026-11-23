'use client'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Plus } from 'lucide-react'

import { translate } from '@/lib/i18n'
import {
  dayLabel,
  isOpen,
  longDayLabel,
  timeLabel,
  WEEKDAYS,
  weekdayOf,
  zoned,
  type Occurrence,
} from '@/lib/scheduling'

import { HostDot, PAST_HATCH } from './bits'
import { DAY_OFF_TINT, dayOffHint, type DaysOff } from './day-off'

/** The month's weeks: each day a compact count, its sessions in a popover; a day from today on adds a session. */
export function MonthView({
  days,
  month,
  zone,
  today,
  occurrences,
  daysOff,
  canWrite,
  onOpen,
  onCreate,
}: {
  days: string[]
  /** "2026-12": days outside it are muted. */
  month: string
  zone: string
  today: string
  occurrences: Occurrence[]
  daysOff: DaysOff
  canWrite: boolean
  onOpen: (occurrence: Occurrence) => void
  /** A new session on the day; a day off goes through the form's special-request warning. */
  onCreate: (date: string) => void
}) {
  const byDay = new Map<string, Occurrence[]>()
  for (const occurrence of occurrences) {
    const date = zoned(occurrence.starts_at, zone).date
    byDay.set(date, [...(byDay.get(date) ?? []), occurrence])
  }
  return (
    <div className="flex min-h-80 flex-1 flex-col overflow-hidden border-t bg-card">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAYS.map((day, index) => (
          <span key={day} className="px-2 py-1.5 text-caption text-muted-foreground">
            {dayLabel(days[index] ?? '').split(/[ ,]/)[0]}
          </span>
        ))}
      </div>
      {/* The weeks share the height; a short screen scrolls them. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {days.map((day) => {
          const sessions = byDay.get(day) ?? []
          const open = sessions.filter((entry) => isOpen(entry.status)).length
          const inMonth = day.startsWith(month)
          const past = day < today
          const dayOff = daysOff.get(day)
          const canAdd = canWrite && !past
          const addLabel = translate('schedNewSessionOn', { day: longDayLabel(day) })
          return (
            <div
              key={day}
              data-day-cell={day}
              data-past={past || undefined}
              data-day-off={dayOff ? true : undefined}
              title={dayOff && !canAdd ? dayOffHint(dayOff) : undefined}
              className={cn(
                'group/day relative min-h-20 border-b border-l p-1.5 sm:min-h-24',
                weekdayOf(day) === 1 && 'border-l-0',
                !inMonth && 'bg-muted/40',
                dayOff && DAY_OFF_TINT,
                past && PAST_HATCH,
                past && canWrite && 'cursor-not-allowed',
              )}
            >
              {canAdd && (
                <>
                  {/* The whole cell adds (Enter from the keyboard); the content above lets clicks through. */}
                  <button
                    type="button"
                    aria-label={dayOff ? `${addLabel}. ${dayOffHint(dayOff)}` : addLabel}
                    title={dayOff ? dayOffHint(dayOff) : undefined}
                    onClick={() => onCreate(day)}
                    className="absolute inset-0 cursor-pointer transition-colors group-hover/day:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden
                        data-add-day={day}
                        onClick={() => onCreate(day)}
                        className="absolute top-1.5 right-1.5 z-10 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-focus-within/day:opacity-100 group-hover/day:opacity-100 hover:bg-background hover:text-foreground"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{addLabel}</TooltipContent>
                  </Tooltip>
                </>
              )}
              <span
                data-today={day === today || undefined}
                className={cn(
                  'pointer-events-none relative inline-flex size-6 items-center justify-center rounded-full text-body-sm tabular-nums',
                  day === today
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : !inMonth && 'text-muted-foreground',
                )}
              >
                {Number(day.slice(8))}
              </span>
              {dayOff && (
                <span className="pointer-events-none relative mt-1 block w-fit max-w-full truncate rounded-sm bg-warning-surface px-1.5 py-0.5 text-caption text-warning">
                  <span className="sr-only">{translate('schedDayOff')}: </span>
                  {dayOff}
                </span>
              )}
              {sessions.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="relative mt-1 flex w-full items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-left text-caption font-medium text-brand hover:bg-brand/15"
                    >
                      {translate('schedSessionsCount', { count: sessions.length })}
                      {open < sessions.length && (
                        <span className="sr-only">
                          {translate('schedOpenCount', { count: open })}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 gap-1 p-1.5">
                    <p className="px-2 pt-1 pb-1.5 text-body-sm font-medium">{dayLabel(day)}</p>
                    <ul className="grid">
                      {sessions.map((occurrence) => (
                        <li key={occurrence.id}>
                          <button
                            type="button"
                            onClick={() => onOpen(occurrence)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm hover:bg-muted',
                              !isOpen(occurrence.status) &&
                                occurrence.status !== 'attended' &&
                                'text-muted-foreground line-through',
                            )}
                          >
                            <HostDot id={occurrence.host?.id} />
                            <span className="text-muted-foreground tabular-nums">
                              {timeLabel(occurrence.starts_at, zone)}
                            </span>
                            <span className="truncate">{occurrence.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
