'use client'
import { Button } from '@helvetly/ui/components/button'
import { Combobox } from '@helvetly/ui/components/combobox'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarDays, Download } from 'lucide-react'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  longDayLabel,
  occurrencesCsv,
  STATUS_LABEL,
  STATUSES,
  timeLabel,
  zoned,
  type Occurrence,
  type Status,
} from '@/lib/scheduling'

import { HostDot, StatusBadge } from './bits'

const unique = (pairs: [string, string][]) =>
  [...new Map(pairs).entries()].map(([value, label]) => ({ value, label }))

/** Sessions grouped by day, filtered by status, client and engagement, with a CSV of what is shown. */
export function ListView({
  zone,
  occurrences,
  onOpen,
  empty,
}: {
  zone: string
  occurrences: Occurrence[]
  onOpen: (occurrence: Occurrence) => void
  empty: string
}) {
  const [statuses, setStatuses] = useState<Status[]>([])
  const [client, setClient] = useState('')
  const [engagement, setEngagement] = useState('')
  const clients = unique(occurrences.map((entry) => [entry.client.id, entry.client.name]))
  const engagements = unique(
    occurrences.flatMap((entry) =>
      entry.engagement
        ? [[entry.engagement.id, `#${entry.engagement.number} ${entry.engagement.title}`]]
        : [],
    ),
  )
  const rows = occurrences.filter(
    (entry) =>
      (statuses.length === 0 || statuses.includes(entry.status)) &&
      (!client || entry.client.id === client) &&
      (!engagement || entry.engagement?.id === engagement),
  )
  const groups = new Map<string, Occurrence[]>()
  for (const row of rows) {
    const date = zoned(row.starts_at, zone).date
    groups.set(date, [...(groups.get(date) ?? []), row])
  }
  const download = () => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([occurrencesCsv(rows, zone)], { type: 'text/csv' }))
    link.download = 'sessions.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          label={translate('status')}
          placeholder={translate('schedAnyStatus')}
          value=""
          values={statuses}
          options={STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] }))}
          onChange={(value) =>
            setStatuses((current) =>
              current.some((entry) => entry === value)
                ? current.filter((entry) => entry !== value)
                : [...current, ...STATUSES.filter((status) => status === value)],
            )
          }
          onClear={() => setStatuses([])}
          clearLabel={translate('schedClearStatus')}
          className="w-48"
        />
        <Combobox
          label={translate('client')}
          placeholder={translate('anyClient')}
          value={client}
          options={clients}
          onChange={setClient}
          onClear={() => setClient('')}
          clearLabel={translate('schedClearClient')}
          disabled={clients.length === 0}
          className="w-52"
        />
        <Combobox
          label={translate('schedEngagement')}
          placeholder={translate('schedAnyEngagement')}
          value={engagement}
          options={engagements}
          onChange={setEngagement}
          onClear={() => setEngagement('')}
          clearLabel={translate('schedClearEngagement')}
          disabled={engagements.length === 0}
          className="w-52"
        />
        <Button
          type="button"
          variant="ghost"
          className="ml-auto"
          disabled={rows.length === 0}
          onClick={download}
        >
          <Download />
          {translate('schedExportCsv')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={empty}
          className="flex-1 justify-center rounded-xl border bg-card"
        />
      ) : (
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto">
          {[...groups.entries()].map(([date, sessions]) => (
            <section key={date} className="grid gap-1.5">
              <h3 className="px-1 text-body-sm font-medium text-muted-foreground">
                {longDayLabel(date)}
              </h3>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {sessions.map((occurrence) => (
                  <li key={occurrence.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(occurrence)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="w-24 shrink-0 text-body-sm text-muted-foreground tabular-nums">
                        {timeLabel(occurrence.starts_at, zone)}–
                        {timeLabel(occurrence.ends_at, zone)}
                      </span>
                      <span className="grid min-w-0 flex-1 leading-tight">
                        <span
                          className={cn(
                            'truncate text-body-sm font-medium',
                            occurrence.status.startsWith('cancelled') && 'line-through',
                          )}
                        >
                          {occurrence.title}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-caption text-muted-foreground">
                          {occurrence.client.name}
                          {occurrence.host && (
                            <>
                              <span aria-hidden>·</span>
                              <HostDot id={occurrence.host.id} />
                              {occurrence.host.name}
                            </>
                          )}
                        </span>
                      </span>
                      <StatusBadge status={occurrence.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
