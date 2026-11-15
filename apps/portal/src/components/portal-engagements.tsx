'use client'
import { Loader } from '@helvetly/ui/components/loader'
import { Meter } from '@helvetly/ui/components/meter'
import { TONES, type Tone } from '@helvetly/ui/components/status-badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Gauge } from 'lucide-react'
import type { ReactNode } from 'react'

import { civilToday, daysLeftText } from '@/lib/dates'
import { translate } from '@/lib/i18n'
import { listPortalEngagements, portalKeys, type PortalEngagement } from '@/lib/portal'

import { cardClass, EmptyState, PageHeader, RetryAlert } from './portal-bits'

/** The most the overage segment may take of the bar (as the staff engagement bar). */
const MAX_OVER_SHARE = 0.5

export function UsageBar({ engagement }: { engagement: PortalEngagement }) {
  const period = engagement.current_period
  if (!period) return null
  const quantity = Number(engagement.quantity)
  return (
    <Meter
      label={translate('ofUsed', {
        value1: Number(period.used),
        quantity: quantity,
        unit: engagement.unit,
      })}
      value={Math.min(Number(period.used), quantity * (1 + MAX_OVER_SHARE))}
      max={quantity}
      size="lg"
    />
  )
}

const PER: Record<string, string> = {
  weekly: translate('dynamicWeek'),
  monthly: translate('dynamicMonth'),
  quarterly: translate('dynamicQuarter'),
  yearly: translate('dynamicYear'),
}

/** "10 hours per month"; a one-off ('none') is "10 hours in total". */
const commitment = ({ quantity, unit, recurrence }: PortalEngagement) =>
  `${Number(quantity)} ${unit} ${PER[recurrence] ? translate('dynamicPer', { value1: PER[recurrence] }) : translate('inTotal')}`

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-2.5 text-body-sm tabular-nums ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

function EngagementCard({ engagement, today }: { engagement: PortalEngagement; today: string }) {
  const period = engagement.current_period
  const quantity = Number(engagement.quantity)
  const share = period && quantity > 0 ? Number(period.used) / quantity : 0
  return (
    <li className={cn(cardClass, 'grid content-start gap-4 p-4 sm:p-5')}>
      <div className="grid gap-0.5">
        <h2 className="text-title-sm font-medium">{engagement.name}</h2>
        <p className="text-body-sm text-muted-foreground">{commitment(engagement)}</p>
      </div>
      {period ? (
        <>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {Number(period.used)}
                <span className="text-base font-normal text-muted-foreground">
                  {' '}
                  / {quantity} {engagement.unit}
                </span>
              </p>
              <span className="text-sm text-muted-foreground tabular-nums">
                {Math.round(share * 100)}%
              </span>
            </div>
            <UsageBar engagement={engagement} />
          </div>
          <div className="flex flex-wrap gap-2">
            {Number(period.overage) > 0 ? (
              <Chip tone="amber">
                {translate('overage')}
                {Number(period.overage)} {engagement.unit}
              </Chip>
            ) : (
              <Chip tone="gray">
                {translate('remaining')}
                {Number(period.remaining)} {engagement.unit}
              </Chip>
            )}
          </div>
          <p className="flex flex-wrap justify-between gap-x-3 border-t pt-3 text-body-sm text-muted-foreground">
            <span>
              {formatDate(period.starts_on)} – {formatDate(period.ends_on)}
            </span>
            <span>{daysLeftText(period.ends_on, today)}</span>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{translate('noPeriodIsRunningRightNow')}</p>
      )}
    </li>
  )
}

export function PortalEngagements() {
  const query = useQuery({ queryKey: portalKeys.engagements, queryFn: listPortalEngagements })
  const today = civilToday()
  return (
    <div className="grid gap-5 sm:gap-6">
      <PageHeader title={translate('engagements')}>
        {translate('theWorkAgreedWithYouAndHowMuchOf')}
      </PageHeader>
      {query.isPending ? (
        <Loader className="min-h-52" />
      ) : query.error ? (
        <div className={cn(cardClass, 'p-4 sm:p-5')}>
          <RetryAlert what={translate('yourEngagements')} onRetry={() => void query.refetch()} />
        </div>
      ) : query.data.length === 0 ? (
        <div className={cardClass}>
          <EmptyState icon={Gauge} title={translate('noActiveEngagements')}>
            {translate('agreedWorkSuchAsAMonthlySupportRetainerShows')}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4">
          {query.data.map((engagement) => (
            <EngagementCard key={engagement.id} engagement={engagement} today={today} />
          ))}
        </ul>
      )}
    </div>
  )
}
