'use client'
import { CalendarDays, Inbox } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { DashboardCard, LIST_ROW } from '@/components/dashboard/dashboard-card'
import { RecordLink } from '@/components/record-link'
import { translate } from '@/lib/i18n'
import { addDays, instantOf, timeLabel, useOccurrences, useRequests, zoned } from '@/lib/scheduling'
import { getWorkspaceTimezone } from '@/lib/timezone'

import { HostDot, StatusBadge } from './bits'

/** Dashboard card: my sessions still to come today and the requests waiting; absent when there are neither. */
export function TodayCard({ className, now: fixedNow }: { className?: string; now?: Date }) {
  const [now] = useState(() => fixedNow ?? new Date())
  const locked = Boolean(useFeatureLock('scheduling'))
  const zone = getWorkspaceTimezone()
  const today = zoned(now, zone).date
  const sessions = useOccurrences(
    {
      from: now.toISOString(),
      to: instantOf(addDays(today, 1), 0, zone).toISOString(),
      host: 'me',
      status: 'requested,scheduled,rescheduled',
    },
    !locked,
  )
  const requests = useRequests(!locked)
  const rows = sessions.data ?? []
  const waiting = requests.data?.length ?? 0
  if (locked || (rows.length === 0 && waiting === 0)) return null

  return (
    <DashboardCard
      title={translate('schedToday')}
      icon={CalendarDays}
      tone="info"
      viewAll={{ href: '/scheduling', label: translate('schedScheduling') }}
      className={className}
    >
      {waiting > 0 && (
        <p className="px-4 pb-1">
          <Link
            href="/scheduling"
            className="inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-body-sm text-warning hover:underline"
          >
            <Inbox className="size-3.5" />
            {translate('schedRequestsWaiting', { count: waiting })}
          </Link>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-body-sm text-muted-foreground">
          {translate('schedNothingElseToday')}
        </p>
      ) : (
        <ul className="grid px-1.5 pt-1 pb-2">
          {rows.slice(0, 4).map((row) => (
            <li key={row.id}>
              <RecordLink
                href={`/scheduling?session=${encodeURIComponent(row.id)}`}
                className={LIST_ROW}
              >
                <span className="w-12 shrink-0 text-body-sm font-medium tabular-nums">
                  {timeLabel(row.starts_at, zone)}
                </span>
                <span className="grid min-w-0 gap-0.5 leading-tight">
                  <span className="truncate">{row.title}</span>
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-body-sm text-muted-foreground">
                    <HostDot id={row.host?.id} />
                    {row.client.name}
                  </span>
                </span>
                {row.status === 'requested' && (
                  <span className="ml-auto shrink-0">
                    <StatusBadge status={row.status} />
                  </span>
                )}
              </RecordLink>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}
