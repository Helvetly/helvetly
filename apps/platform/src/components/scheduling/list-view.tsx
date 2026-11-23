'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { Download, MapPin, Plus, Video } from 'lucide-react'
import { Fragment, useState } from 'react'

import { ListFilters } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { translate } from '@/lib/i18n'
import { among, type QueryField, type QueryOption } from '@/lib/list-query'
import {
  hostColor,
  longDayLabel,
  occurrencesCsv,
  periodLabel,
  STATUS_LABEL,
  STATUSES,
  timeLabel,
  zoned,
  weekdayName,
  weekdayOf,
  WEEKDAYS,
  type Meeting,
  type Occurrence,
  type Status,
} from '@/lib/scheduling'

import { StatusBadge } from './bits'
import { DayOffLine, withDaysOff, type DaysOff } from './day-off'

type Filter = { statuses: Status[]; client: string[]; engagement: string[] }
const NO_FILTER: Filter = { statuses: [], client: [], engagement: [] }

const unique = (pairs: [string, string][]): QueryOption[] =>
  [...new Map(pairs).entries()].map(([value, label]) => ({ value, label }))

const queryFields = (occurrences: Occurrence[]): QueryField<Filter>[] => [
  {
    id: 'status',
    label: translate('status'),
    type: 'enum',
    kind: 'status',
    values: STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] })),
    placeholder: translate('schedAnyStatus'),
    get: (filter) => filter.statuses,
    set: (values) => ({ statuses: among(STATUSES, values) }),
  },
  {
    id: 'client',
    label: translate('client'),
    type: 'enum',
    single: true,
    values: unique(occurrences.map((entry) => [entry.client.id, entry.client.name])),
    placeholder: translate('anyClient'),
    get: (filter) => filter.client,
    set: (values) => ({ client: values.slice(-1) }),
  },
  {
    id: 'engagement',
    label: translate('schedEngagement'),
    type: 'enum',
    single: true,
    values: unique(
      occurrences.flatMap((entry) =>
        entry.engagement
          ? [[entry.engagement.id, `#${entry.engagement.number} ${entry.engagement.title}`]]
          : [],
      ),
    ),
    placeholder: translate('schedAnyEngagement'),
    get: (filter) => filter.engagement,
    set: (values) => ({ engagement: values.slice(-1) }),
  },
]

const MEETING_LABEL: Record<Meeting['provider'], string> = {
  google_meet: 'Google Meet',
  teams: 'Microsoft Teams',
  manual: translate('schedMeetingLink'),
}

/** Where a session takes place, short: the meeting's provider or the first part of the address. */
function Place({ occurrence }: { occurrence: Occurrence }) {
  if (occurrence.meeting)
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Video className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{MEETING_LABEL[occurrence.meeting.provider]}</span>
      </span>
    )
  if (!occurrence.location) return null
  return (
    <span className="flex min-w-0 items-center gap-1">
      <MapPin className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{occurrence.location.split(',')[0]}</span>
    </span>
  )
}

const matches = (entry: Occurrence, text: string) =>
  [entry.title, entry.client.name, entry.host?.name, entry.engagement?.title, entry.location].some(
    (value) => value?.toLowerCase().includes(text),
  )

/**
 * The agenda: the period's sessions by day, a date column on the left and the day's sessions on the
 * right, days without sessions left out. Filters, a search and a CSV of what is shown sit on top.
 */
export function ListView({
  zone,
  occurrences,
  daysOff,
  now,
  onOpen,
  onNew,
  empty,
}: {
  zone: string
  occurrences: Occurrence[]
  /** The range's days off, each shown on its date. */
  daysOff?: DaysOff
  now: Date
  onOpen: (occurrence: Occurrence) => void
  /** Offered in an empty period when the person may schedule. */
  onNew?: () => void
  empty: string
}) {
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [search, setSearch] = useState('')
  const fields = queryFields(occurrences)
  const update = (change: Partial<Filter>) => setFilter((current) => ({ ...current, ...change }))
  const text = search.trim().toLowerCase()
  const rows = occurrences.filter(
    (entry) =>
      (filter.statuses.length === 0 || filter.statuses.includes(entry.status)) &&
      (filter.client.length === 0 || filter.client.includes(entry.client.id)) &&
      (filter.engagement.length === 0 || filter.engagement.includes(entry.engagement?.id ?? '')) &&
      (!text || matches(entry, text)),
  )
  const groups = new Map<string, Occurrence[]>()
  for (const row of rows) {
    const date = zoned(row.starts_at, zone).date
    groups.set(date, [...(groups.get(date) ?? []), row])
  }
  const days = withDaysOff(groups, daysOff).map(([date]) => date)
  const crossesMonths = new Set(days.map((day) => day.slice(0, 7))).size > 1
  const today = zoned(now, zone).date
  const download = () => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([occurrencesCsv(rows, zone)], { type: 'text/csv' }))
    link.download = 'sessions.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar>
        <ListFilters fields={fields} params={filter} onChange={update} />
        <ListSearch
          label={translate('schedSearchSessions')}
          placeholder={translate('schedSearchSessionsPlaceholder')}
          value={search}
          onChange={setSearch}
          query={{ fields, params: filter, onChange: update }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={rows.length === 0}
          onClick={download}
        >
          <Download />
          <span className="max-sm:sr-only">{translate('schedExportCsv')}</span>
        </Button>
      </ListToolbar>

      {rows.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-4 text-body-sm text-muted-foreground sm:px-6">
          <p>{empty}</p>
          {onNew && (
            <Button type="button" variant="ghost" size="sm" onClick={onNew}>
              <Plus />
              {translate('schedNewSession')}
            </Button>
          )}
        </div>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {days.map((date, index) => {
            const previous = days[index - 1]
            const newMonth = crossesMonths && previous?.slice(0, 7) !== date.slice(0, 7)
            const past = date < today
            return (
              <Fragment key={date}>
                {newMonth && (
                  <li
                    data-month={date.slice(0, 7)}
                    className="border-b bg-muted/40 px-4 py-1.5 text-caption font-medium text-muted-foreground sm:px-6"
                  >
                    {periodLabel('month', date)}
                  </li>
                )}
                <li data-list-day={date} className="flex gap-2 border-b px-2 py-2 sm:gap-4 sm:px-4">
                  <h3
                    className={cn(
                      'flex w-11 shrink-0 flex-col items-center pt-1 sm:w-16',
                      past && 'text-muted-foreground',
                    )}
                  >
                    <span className="sr-only">{longDayLabel(date)}</span>
                    <span aria-hidden className="text-caption uppercase">
                      {weekdayName(WEEKDAYS[weekdayOf(date) - 1] ?? 'MO', 'short')}
                    </span>
                    <span
                      aria-hidden
                      data-today={date === today || undefined}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full text-title-sm tabular-nums',
                        date === today && 'bg-primary font-semibold text-primary-foreground',
                      )}
                    >
                      {Number(date.slice(8))}
                    </span>
                  </h3>
                  <ul className="grid min-w-0 flex-1 gap-0.5">
                    {daysOff?.has(date) && (
                      <li className="py-2">
                        <DayOffLine name={daysOff.get(date) ?? ''} />
                      </li>
                    )}
                    {(groups.get(date) ?? []).map((occurrence) => (
                      <li key={occurrence.id}>
                        <SessionRow
                          occurrence={occurrence}
                          zone={zone}
                          past={new Date(occurrence.ends_at) < now}
                          onOpen={onOpen}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              </Fragment>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function SessionRow({
  occurrence,
  zone,
  past,
  onOpen,
}: {
  occurrence: Occurrence
  zone: string
  past: boolean
  onOpen: (occurrence: Occurrence) => void
}) {
  const cancelled = occurrence.status.startsWith('cancelled')
  return (
    <button
      type="button"
      onClick={() => onOpen(occurrence)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
    >
      <span
        aria-hidden
        className={cn(
          'w-1 shrink-0 self-stretch rounded-full',
          (past || cancelled) && 'opacity-50',
        )}
        style={{ backgroundColor: hostColor(occurrence.host?.id) }}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums sm:w-28">
          {timeLabel(occurrence.starts_at, zone)}–{timeLabel(occurrence.ends_at, zone)}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
          <span
            className={cn(
              'truncate text-body-sm font-medium',
              (past || cancelled) && 'text-muted-foreground',
              cancelled && 'line-through',
            )}
          >
            {occurrence.title}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
            <span className="truncate">{occurrence.client.name}</span>
            {occurrence.engagement && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">
                  #{occurrence.engagement.number} {occurrence.engagement.title}
                </span>
              </>
            )}
            {(occurrence.meeting || occurrence.location) && <span aria-hidden>·</span>}
            <Place occurrence={occurrence} />
            {occurrence.host && <span className="sr-only">, {occurrence.host.name}</span>}
          </span>
        </span>
      </span>
      <StatusBadge status={occurrence.status} />
    </button>
  )
}
