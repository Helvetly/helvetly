'use client'
import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Meter } from '@helvetly/ui/components/meter'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { byDay, formatDay } from '@helvetly/ui/lib/days'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Gauge, History, MessageSquareHeart } from 'lucide-react'
import { useEffect, useId, useState, useSyncExternalStore } from 'react'

import { civilToday, daysLeftText, formatPeriod } from '@/lib/dates'
import { isActive, usedShare } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import {
  listPortalEngagementHistory,
  listPortalEngagements,
  portalKeys,
  type PortalEngagement,
  type PortalEngagementPeriod,
} from '@/lib/portal'
import { amountOf, shortAmount } from '@/lib/units'

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
        used: Number(period.used),
        total: amountOf(quantity, engagement.unit),
      })}
      value={Math.min(Number(period.used), quantity * (1 + MAX_OVER_SHARE))}
      max={quantity}
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
  `${amountOf(quantity, unit)} ${PER[recurrence] ? translate('dynamicPer', { value1: PER[recurrence] }) : translate('inTotal')}`

const PAST: Record<Exclude<PortalEngagement['status'], 'active'>, [string, Tone]> = {
  ended: [translate('ended'), 'neutral'],
  cancelled: [translate('statusCancelled'), 'neutral'],
  expired: [translate('statusExpired'), 'neutral'],
  used_up: [translate('statusUsedUp'), 'green'],
}

type Entry = PortalEngagementPeriod['entries'][number]

/** Sums decimal quantities without float noise ("0.1" + "0.2" is 0.3). */
const total = (entries: Entry[]) =>
  Math.round(entries.reduce((sum, entry) => sum + Number(entry.quantity) * 1000, 0)) / 1000

/**
 * One logged delivery as a compact row: the note (or a calm "Work logged" when there is neither note nor a word for
 * the client), the supplier's word for the client as a quiet quote under it, the quantity on the right.
 */
function ActivityEntry({ entry, unit }: { entry: Entry; unit: string | null }) {
  const note = entry.note?.trim()
  const forYou = entry.client_performance?.trim()
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <div className="grid min-w-0 gap-1.5">
        {note && <p className="text-body break-words">{note}</p>}
        {!note && !forYou && (
          <p className="text-body text-muted-foreground">{translate('workLogged')}</p>
        )}
        {forYou && (
          <figure className="flex gap-2 rounded-md bg-brand-surface px-2.5 py-1.5 text-body-sm">
            <MessageSquareHeart aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand" />
            <figcaption className="min-w-0 break-words">
              <span className="font-medium">{translate('clientPerformance')}</span>
              <span className="sr-only">:</span> {forYou}
            </figcaption>
          </figure>
        )}
      </div>
      <span className="shrink-0 pt-px text-body-sm text-muted-foreground tabular-nums">
        {shortAmount(entry.quantity, unit)}
      </span>
    </li>
  )
}

/** A period's days, newest first: the date once with the day's total, its entries below as compact rows. */
function Days({ entries, unit }: { entries: Entry[]; unit: string | null }) {
  return (
    <ol className="grid gap-4">
      {byDay(entries).map((day) => (
        <li key={day.date} className="grid">
          <p className="flex items-baseline gap-2 border-b border-border/60 pb-1.5 text-body-sm">
            <time dateTime={day.date} className="font-medium">
              {formatDay(day.date)}
            </time>
            <span className="text-muted-foreground tabular-nums">
              {translate('dayTotal', { total: shortAmount(total(day.items), unit) })}
            </span>
          </p>
          <ul className="grid divide-y divide-border/40">
            {day.items.map((entry) => (
              <ActivityEntry key={entry.id} entry={entry} unit={unit} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

/** An earlier period, folded to one line with what was used in it; it opens on its own to show its days. */
function EarlierPeriod({
  period,
  engagement,
}: {
  period: PortalEngagementPeriod
  engagement: PortalEngagement
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const range = formatPeriod(period.starts_on, period.ends_on)
  return (
    <li className="grid">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-left text-body-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            !open && '-rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium tabular-nums">{range}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {shortAmount(total(period.entries), null)} /{' '}
          {shortAmount(engagement.quantity, engagement.unit)}
          <span className="max-sm:hidden">
            {' · '}
            {translate('entriesCount', { count: period.entries.length })}
          </span>
        </span>
      </button>
      {open && (
        <section id={id} aria-label={range} className="pt-1 pb-2 pl-6">
          {period.entries.length === 0 ? (
            <p className="py-1 text-body-sm text-muted-foreground">
              {translate('nothingLoggedInThisPeriod')}
            </p>
          ) : (
            <Days entries={period.entries} unit={engagement.unit} />
          )}
        </section>
      )}
    </li>
  )
}

/**
 * Every logged delivery. The row above already shows the current period's numbers and dates, so its entries follow
 * at once under a quiet "This period"; earlier periods are folded lines with their totals.
 */
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
  const running = isActive(engagement) ? engagement.current_period?.starts_on : undefined
  const current = query.data.find((period) => period.starts_on === running)
  const earlier = query.data.filter((period) => period !== current)
  return (
    <div className="grid gap-4">
      {running && (
        <section aria-label={translate('thisPeriod')} className="grid gap-2">
          <h3 className="text-caption font-medium text-muted-foreground">
            {translate('thisPeriod')}
          </h3>
          {current && current.entries.length > 0 ? (
            <Days entries={current.entries} unit={engagement.unit} />
          ) : (
            <p className="text-body-sm text-muted-foreground">
              {translate('nothingLoggedInThisPeriod')}
            </p>
          )}
        </section>
      )}
      {earlier.length > 0 && (
        <section aria-label={translate('earlierPeriods')} className="grid gap-1">
          {running && (
            <h3 className="text-caption font-medium text-muted-foreground">
              {translate('earlierPeriods')}
            </h3>
          )}
          <ul className="grid">
            {earlier.map((period) => (
              <EarlierPeriod key={period.starts_on} period={period} engagement={engagement} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/**
 * One engagement as a compact row: name (and why it is past), what was agreed with the period and days left, a thin
 * bar, and used / agreed with the share on the right. Details opens the activity below; a deep link opens it at once.
 */
function EngagementRow({
  engagement,
  today,
  linked,
}: {
  engagement: PortalEngagement
  today: string
  linked: boolean
}) {
  const [open, setOpen] = useState(linked)
  const id = useId()
  const period = engagement.current_period
  const past = engagement.status !== 'active' ? PAST[engagement.status] : null
  const overage = period ? Number(period.overage) : 0
  return (
    <li id={engagement.id} className="scroll-mt-24">
      {/* The Details button stretches over the row, so a click anywhere on it opens the activity. */}
      <div className="relative grid gap-2 px-4 py-3.5 transition-colors has-[[data-toggle]:hover]:bg-muted/40 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 id={`${id}-title`} className="truncate text-body font-medium">
              {engagement.name}
            </h2>
            {past && (
              <Badge tone={past[1]} size="sm" className="shrink-0">
                {past[0]}
              </Badge>
            )}
          </div>
          {period && (
            <p className="shrink-0 text-body-sm tabular-nums">
              <span className="font-medium">
                {Number(period.used)} / {shortAmount(engagement.quantity, engagement.unit)}
              </span>
              <span className="text-muted-foreground">
                {' '}
                · {Math.round(usedShare(engagement) * 100)}%
              </span>
            </p>
          )}
          <Button
            data-toggle
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={`${id}-activity`}
            onClick={() => setOpen(!open)}
            className="-my-1 -mr-2 shrink-0 text-muted-foreground after:absolute after:inset-0"
          >
            <span className="max-sm:sr-only">{translate('details')}</span>
            <ChevronDown
              data-icon="inline-end"
              aria-hidden
              className={cn('transition-transform duration-200', open && 'rotate-180')}
            />
          </Button>
        </div>
        <p className="truncate text-body-sm text-muted-foreground">
          {commitment(engagement)}
          {period ? (
            <>
              <span className="tabular-nums">
                {' '}
                · {formatPeriod(period.starts_on, period.ends_on)}
              </span>
              {!past && <> · {daysLeftText(period.ends_on, today)}</>}
              {overage > 0 && (
                <span className="text-warning">
                  {' · '}
                  {translate('overage')}
                  {amountOf(overage, engagement.unit)}
                </span>
              )}
            </>
          ) : (
            <> · {translate('noPeriodIsRunningRightNow')}</>
          )}
        </p>
        <UsageBar engagement={engagement} />
      </div>
      {open && (
        <section
          id={`${id}-activity`}
          aria-labelledby={`${id}-title`}
          className="border-t border-border/60 bg-muted/20 px-4 pt-3 pb-4 sm:px-6"
        >
          <Activity engagement={engagement} />
        </section>
      )}
    </li>
  )
}

type Tab = 'active' | 'past'
const isTab = (value: string): value is Tab => value === 'active' || value === 'past'

const onHashChange = (change: () => void) => {
  window.addEventListener('hashchange', change)
  return () => window.removeEventListener('hashchange', change)
}

/** The engagement a link names (`/engagements#eng_1`); nothing while the page is prerendered. */
const useLinkedId = () =>
  useSyncExternalStore(
    onHashChange,
    () => decodeURIComponent(window.location.hash.slice(1)),
    () => '',
  )

export function PortalEngagements() {
  const query = useQuery({ queryKey: portalKeys.engagements, queryFn: listPortalEngagements })
  const today = civilToday()
  const linked = useLinkedId()
  const [chosen, setChosen] = useState<Tab | null>(null)
  const target = query.data?.find((engagement) => engagement.id === linked)
  const tab: Tab = chosen ?? (target && !isActive(target) ? 'past' : 'active')

  useEffect(() => {
    if (target) document.getElementById(target.id)?.scrollIntoView({ block: 'start' })
  }, [target])

  const body = () => {
    if (query.isPending) return <Loader className="min-h-52" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('yourEngagements')} onRetry={() => void query.refetch()} />
        </div>
      )
    const lists: Record<Tab, PortalEngagement[]> = {
      active: query.data.filter(isActive),
      past: query.data.filter((engagement) => !isActive(engagement)),
    }
    const empty: Record<Tab, [string, string]> = {
      active: [
        translate('noActiveEngagements'),
        translate('agreedWorkSuchAsAMonthlySupportRetainerShows'),
      ],
      past: [translate('noPastEngagements'), translate('pastEngagementsMoveHere')],
    }
    const shown = lists[tab]
    return (
      <Tabs
        value={tab}
        onValueChange={(value) => isTab(value) && setChosen(value)}
        className="gap-4"
      >
        <TabsList
          aria-label={translate('show')}
          className="h-9 max-w-full overflow-x-auto bg-card shadow-elevation-1"
        >
          {(['active', 'past'] as const).map((key) => (
            <TabsTrigger key={key} value={key} className="px-3">
              {key === 'active' ? translate('activeEngagements') : translate('pastEngagements')}
              <span className="text-xs text-muted-foreground tabular-nums">
                {lists[key].length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {shown.length === 0 ? (
            <div className={cardClass}>
              <EmptyState icon={tab === 'active' ? Gauge : History} title={empty[tab][0]}>
                {empty[tab][1]}
              </EmptyState>
            </div>
          ) : (
            <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
              {shown.map((engagement) => (
                <EngagementRow
                  key={`${engagement.id}-${engagement.id === linked}`}
                  engagement={engagement}
                  today={today}
                  linked={engagement.id === linked}
                />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    )
  }

  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader title={translate('engagements')}>
        {translate('theWorkAgreedWithYouAndHowMuchOf')}
      </PageHeader>
      {body()}
    </div>
  )
}
