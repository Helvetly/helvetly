'use client'
import { Disclosure } from '@helvetly/ui/components/disclosure'
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
import {
  listPortalEngagementHistory,
  listPortalEngagements,
  portalKeys,
  type PortalEngagement,
} from '@/lib/portal'

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

/** Every logged delivery, by period and newest first: date, quantity, note and how the client did. */
function History({ engagement }: { engagement: PortalEngagement }) {
  const query = useQuery({
    queryKey: portalKeys.engagementHistory(engagement.id),
    queryFn: () => listPortalEngagementHistory(engagement.id),
  })
  if (query.isPending) return <Loader className="min-h-11" />
  if (query.error)
    return <RetryAlert what={translate('theHistory')} onRetry={() => void query.refetch()} />
  const count = query.data.reduce((sum, period) => sum + period.entries.length, 0)
  if (count === 0)
    return <p className="text-body-sm text-muted-foreground">{translate('nothingLoggedYet')}</p>
  return (
    <Disclosure label={translate('history')} count={count}>
      <div className="grid gap-3 py-2 pr-3">
        {query.data.map((period) => (
          <section key={period.starts_on} className="grid gap-1">
            <h3 className="text-caption font-medium text-muted-foreground tabular-nums">
              {formatDate(period.starts_on)} – {formatDate(period.ends_on)}
            </h3>
            <ol className="divide-y divide-border">
              {period.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2"
                >
                  <time
                    dateTime={entry.date}
                    className="text-body-sm text-muted-foreground tabular-nums"
                  >
                    {formatDate(entry.date)}
                  </time>
                  <span className="row-span-3 text-right text-body-sm font-medium whitespace-nowrap tabular-nums">
                    {Number(entry.quantity)} {engagement.unit}
                  </span>
                  {entry.note && <p className="text-body break-words">{entry.note}</p>}
                  {entry.client_performance && (
                    <p className="text-body-sm break-words text-muted-foreground">
                      <span className="font-medium">{translate('performance')}:</span>{' '}
                      {entry.client_performance}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Disclosure>
  )
}

function EngagementCard({ engagement, today }: { engagement: PortalEngagement; today: string }) {
  const period = engagement.current_period
  const quantity = Number(engagement.quantity)
  const share = period && quantity > 0 ? Number(period.used) / quantity : 0
  return (
    <li className={cn(cardClass, 'grid content-start gap-5 p-4 sm:p-6')}>
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
      <History engagement={engagement} />
    </li>
  )
}

export function PortalEngagements() {
  const query = useQuery({ queryKey: portalKeys.engagements, queryFn: listPortalEngagements })
  const today = civilToday()
  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader title={translate('engagements')}>
        {translate('theWorkAgreedWithYouAndHowMuchOf')}
      </PageHeader>
      {query.isPending ? (
        <Loader className="min-h-52" />
      ) : query.error ? (
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('yourEngagements')} onRetry={() => void query.refetch()} />
        </div>
      ) : query.data.length === 0 ? (
        <div className={cardClass}>
          <EmptyState icon={Gauge} title={translate('noActiveEngagements')}>
            {translate('agreedWorkSuchAsAMonthlySupportRetainerShows')}
          </EmptyState>
        </div>
      ) : (
        <ul className="grid gap-4 sm:gap-6 lg:grid-cols-2">
          {query.data.map((engagement) => (
            <EngagementCard key={engagement.id} engagement={engagement} today={today} />
          ))}
        </ul>
      )}
    </div>
  )
}
