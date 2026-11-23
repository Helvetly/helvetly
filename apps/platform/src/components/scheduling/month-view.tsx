'use client'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'

import { translate } from '@/lib/i18n'
import {
  dayLabel,
  isOpen,
  timeLabel,
  WEEKDAYS,
  weekdayOf,
  zoned,
  type Occurrence,
} from '@/lib/scheduling'

import { HostDot, PAST_HATCH } from './bits'

/** The month's weeks: each day a compact count, its sessions in a popover. */
export function MonthView({
  days,
  month,
  zone,
  today,
  occurrences,
  onOpen,
}: {
  days: string[]
  /** "2026-12": days outside it are muted. */
  month: string
  zone: string
  today: string
  occurrences: Occurrence[]
  onOpen: (occurrence: Occurrence) => void
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
          return (
            <div
              key={day}
              data-past={past || undefined}
              className={cn(
                'min-h-20 border-b border-l p-1.5 sm:min-h-24',
                weekdayOf(day) === 1 && 'border-l-0',
                !inMonth && 'bg-muted/40',
                past && PAST_HATCH,
              )}
            >
              <span
                data-today={day === today || undefined}
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full text-body-sm tabular-nums',
                  day === today
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : !inMonth && 'text-muted-foreground',
                )}
              >
                {Number(day.slice(8))}
              </span>
              {sessions.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="mt-1 flex w-full items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-left text-caption font-medium text-brand hover:bg-brand/15"
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
