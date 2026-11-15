'use client'
import { Button } from '@helvetly/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { RecordLink } from '@/components/record-link'
import { getEngagementSummary, listEngagements, periodLabel } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

import { EngagementStatusBadge } from './engagement-bits'

const SOONEST = { status: 'scheduled,active', sort: 'ends', page_size: 3 } as const

/** Dashboard card: what is ending soon and what waits to be invoiced; absent without engagements. */
export function EngagementsCard() {
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
    <section className="flex min-w-0 flex-col rounded-xl bg-card shadow-elevation-1">
      <div className="flex h-12 items-center justify-between gap-3 border-b px-4">
        <h2 className="text-[15px]">{translate('engagements')}</h2>
        <Button asChild variant="ghost" size="sm" className="font-normal text-muted-foreground">
          <Link href="/engagements">
            {translate('allEngagements')}
            <ArrowRight className="stroke-[1.5]" />
          </Link>
        </Button>
      </div>
      <p className="flex gap-6 px-4 pt-3 text-[13px] text-muted-foreground">
        <span>
          <span className="text-[15px] text-foreground tabular-nums">{stats.ending_soon}</span>{' '}
          {translate('endingSoon2')}
        </span>
        <span>
          <span className="text-[15px] text-foreground tabular-nums">{stats.to_invoice}</span>
          {translate('toInvoice')}
        </span>
      </p>
      <ul className="py-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <RecordLink
              href={`/engagements?id=${encodeURIComponent(row.id)}`}
              className="flex h-14 items-center gap-3 px-4 transition-colors duration-150 hover:bg-muted/50"
            >
              <span className="grid min-w-0 leading-tight">
                <span className="truncate">{row.title}</span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {row.client.name}
                  {row.current_period && ` · ${periodLabel(row.current_period)}`}
                </span>
              </span>
              <span className="ml-auto">
                <EngagementStatusBadge status={row.status} />
              </span>
            </RecordLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
