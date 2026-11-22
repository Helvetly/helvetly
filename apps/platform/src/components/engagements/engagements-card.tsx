'use client'
import { useQuery } from '@tanstack/react-query'
import { Handshake } from 'lucide-react'

import { DashboardCard, LIST_ROW } from '@/components/dashboard/dashboard-card'
import { Initials } from '@/components/initials'
import { RecordLink } from '@/components/record-link'
import { getEngagementSummary, listEngagements, periodLabel } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

import { EngagementStatusBadge } from './engagement-bits'

const SOONEST = { status: 'scheduled,active', sort: 'ends', page_size: 3 } as const

/** Dashboard card: what is ending soon and what waits to be invoiced; absent without engagements. */
export function EngagementsCard({ className }: { className?: string }) {
  const summary = useQuery({
    queryKey: [...queryKeys.engagements, 'summary'],
    queryFn: async () => (await getEngagementSummary()).data,
  })
  const soonest = useQuery({
    queryKey: [...queryKeys.engagements, 'list', SOONEST],
    queryFn: () => listEngagements(SOONEST),
  })
  const stats = summary.data
  const rows = soonest.data?.data ?? []
  if (!stats || (stats.active === 0 && stats.to_invoice === 0 && rows.length === 0)) return null

  return (
    <DashboardCard
      title={translate('engagements')}
      icon={Handshake}
      tone="success"
      viewAll={{ href: '/engagements', label: translate('allEngagements').trim() }}
      className={className}
    >
      <p className="flex flex-wrap gap-2 px-4 pb-1 text-body-sm text-muted-foreground">
        <span className="rounded-full bg-muted px-2.5 py-1">
          <span className="text-foreground tabular-nums">{stats.ending_soon}</span>{' '}
          {translate('endingSoon2')}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1">
          <span className="text-foreground tabular-nums">{stats.to_invoice}</span>
          {translate('toInvoice')}
        </span>
      </p>
      <ul className="grid px-1.5 pt-1 pb-2">
        {rows.map((row) => (
          <li key={row.id}>
            <RecordLink href={`/engagements?id=${encodeURIComponent(row.id)}`} className={LIST_ROW}>
              <Initials name={row.client.name} className="size-9 text-xs" />
              <span className="grid min-w-0 gap-0.5 leading-tight">
                <span className="truncate">{row.title}</span>
                <span className="truncate text-body-sm text-muted-foreground">
                  {row.client.name}
                  {row.current_period && ` · ${periodLabel(row.current_period)}`}
                </span>
              </span>
              <span className="ml-auto shrink-0">
                <EngagementStatusBadge status={row.status} />
              </span>
            </RecordLink>
          </li>
        ))}
      </ul>
    </DashboardCard>
  )
}
