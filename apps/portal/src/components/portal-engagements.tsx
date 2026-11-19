'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Meter } from '@helvetly/ui/components/meter'
import { TONES, type Tone } from '@helvetly/ui/components/status-badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Gauge } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { civilToday, daysLeftText } from '@/lib/dates'
import { translate } from '@/lib/i18n'
import {
  listPortalEngagementHistory,
  listPortalEngagements,
  portalKeys,
  type PortalEngagement,
  type PortalEngagementPeriod,
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

/** One logged delivery: date, quantity, the note and, when the supplier wrote one, the client performance. */
function ActivityRow({
  entry,
  unit,
}: {
  entry: PortalEngagementPeriod['entries'][number]
  unit: string
}) {
  const performance = entry.client_performance?.trim()
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_6rem]">
      <time
        dateTime={entry.date}
        className="text-body-sm text-muted-foreground tabular-nums sm:pt-px"
      >
        {formatDate(entry.date)}
      </time>
      <span className="text-right text-body-sm font-medium whitespace-nowrap tabular-nums sm:col-start-3 sm:row-start-1 sm:pt-px">
        {Number(entry.quantity)} {unit}
      </span>
      {(entry.note || performance) && (
        <div className="col-span-2 grid min-w-0 gap-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          {entry.note && <p className="text-body break-words">{entry.note}</p>}
          {performance && (
            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-body-sm break-words text-muted-foreground">
              <span className="font-medium text-foreground">{translate('clientPerformance')}:</span>{' '}
              {performance}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** Every logged delivery, newest first, with a light divider where a period starts. */
function Activity({ engagement }: { engagement: PortalEngagement }) {
  const query = useQuery({
    queryKey: portalKeys.engagementHistory(engagement.id),
    queryFn: () => listPortalEngagementHistory(engagement.id),
  })
  if (query.isPending) return <Loader className="min-h-20" />
  if (query.error)
    return <RetryAlert what={translate('theHistory')} onRetry={() => void query.refetch()} />
  if (query.data.every((period) => period.entries.length === 0))
    return (
      <p className="py-2 text-body-sm text-muted-foreground">{translate('nothingLoggedYet')}</p>
    )
  return (
    <div className="grid gap-2">
      {query.data.map((period) => (
        <section key={period.starts_on}>
          <h3 className="flex items-center gap-3 text-caption font-medium text-muted-foreground tabular-nums after:h-px after:flex-1 after:bg-border">
            {formatDate(period.starts_on)} – {formatDate(period.ends_on)}
          </h3>
          <ol className="divide-y divide-border/60">
            {period.entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} unit={engagement.unit} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

/**
 * One engagement across the page: what was agreed and how much of it is used, and below it an accordion with
 * the logged activity. Each card opens on its own; nothing is remembered.
 */
function EngagementCard({ engagement, today }: { engagement: PortalEngagement; today: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const period = engagement.current_period
  const quantity = Number(engagement.quantity)
  const share = period && quantity > 0 ? Number(period.used) / quantity : 0
  return (
    <li className={cardClass}>
      {/* The Details button stretches over the summary, so a click anywhere on it opens the activity. */}
      <div className="relative grid gap-4 rounded-xl p-4 transition-colors has-[[data-toggle]:hover]:bg-muted/40 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <h2 id={`${id}-title`} className="text-title-sm font-medium break-words">
              {engagement.name}
            </h2>
            <p className="text-body-sm text-muted-foreground">{commitment(engagement)}</p>
          </div>
          <Button
            data-toggle
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={`${id}-activity`}
            onClick={() => setOpen(!open)}
            className="shrink-0 text-muted-foreground after:absolute after:inset-0 after:rounded-xl"
          >
            {translate('details')}
            <ChevronDown
              data-icon="inline-end"
              aria-hidden
              className={cn('transition-transform duration-200', open && 'rotate-180')}
            />
          </Button>
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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body-sm text-muted-foreground">
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
              <span className="tabular-nums">
                {formatDate(period.starts_on)} – {formatDate(period.ends_on)}
              </span>
              <span aria-hidden>·</span>
              <span>{daysLeftText(period.ends_on, today)}</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{translate('noPeriodIsRunningRightNow')}</p>
        )}
      </div>
      {open && (
        <section
          id={`${id}-activity`}
          aria-labelledby={`${id}-title`}
          className="border-t px-4 pt-3 pb-4 sm:px-6 sm:pb-5"
        >
          <Activity engagement={engagement} />
        </section>
      )}
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
        <ul className="grid gap-4">
          {query.data.map((engagement) => (
            <EngagementCard key={engagement.id} engagement={engagement} today={today} />
          ))}
        </ul>
      )}
    </div>
  )
}
