import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Meter } from '@helvetly/ui/components/meter'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, TrendingUp } from 'lucide-react'
import Link from 'next/link'

import {
  formatLimit,
  LIMIT_LABELS,
  meterState,
  nextPlan,
  type Billing,
  type UsageItem,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { limitLine } from './plan-cards'

const STATE = {
  near: {
    text: translate('almostAtLimit'),
    className: 'text-warning',
    ring: 'ring-warning-border',
  },
  full: {
    text: translate('limitReached'),
    className: 'text-destructive',
    ring: 'ring-destructive/40',
  },
}

/** How full an item is, 0–1+; an unlimited item counts as empty so it sorts last. */
const share = (item: UsageItem) => (item.max === null || item.max === 0 ? -1 : item.used / item.max)

/** The usage, closest to its limit first. */
export function byPressure(usage: UsageItem[]): UsageItem[] {
  return usage.toSorted((a, b) => share(b) - share(a))
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** "Signature requests this month" reads "Signature requests" under a "This month" heading. */
const tileLabel = (item: UsageItem) => LIMIT_LABELS[item.limit].replace(/ this month$/, '')

/**
 * The plan's usage as tiles, numbers first, closest to its limit first: orange near a limit, red at
 * it, with one nudge to the next plan for the item under the most pressure.
 */
export function UsageOverview({ billing }: { billing: Billing }) {
  const items = byPressure(billing.usage)
  const pressing = items.find((item) => meterState(item) !== 'ok')
  return (
    <section
      aria-labelledby="usage-title"
      data-slot="usage-overview"
      className="@container grid gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-1">
        <h2 id="usage-title" className="text-body font-semibold">
          {translate('usage')}
        </h2>
        <p className="text-body-sm text-muted-foreground tabular-nums">
          {translate('thisMonthSince')}
          {formatDate(billing.period_start)}
        </p>
      </div>
      {pressing && <UpgradeNudge billing={billing} item={pressing} />}
      <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-3 @5xl:grid-cols-4">
        {items.map((item) => (
          <UsageTile key={item.limit} item={item} />
        ))}
      </ul>
    </section>
  )
}

/** The item closest to its limit, and what the next plan up gives instead. */
function UpgradeNudge({ billing, item }: { billing: Billing; item: UsageItem }) {
  const full = meterState(item) === 'full'
  const next = billing.enabled ? nextPlan(billing) : undefined
  const label = tileLabel(item)
  return (
    <Callout
      tone={full ? 'danger' : 'warning'}
      icon={TrendingUp}
      data-slot="usage-nudge"
      actions={
        next && (
          <Button asChild size="sm" variant="outline" className="bg-card">
            <Link href="/settings/billing/plans">
              {translate('see')}
              {next.name} <ArrowRight data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        )
      }
    >
      <strong className="font-medium">
        {label}: {full ? translate('thePlanSLimitIsReached') : translate('almostAtThePlanSLimit')}
      </strong>{' '}
      {next
        ? translate('includes2', {
            name: next.name,
            value2: lowerFirst(limitLine(item.limit, next.limits[item.limit] ?? null)),
          })
        : translate('theLimitResetsWithTheNextMonth')}
    </Callout>
  )
}

/** One limit: the count in large type over its limit, a meter, and a note near or at the limit. */
export function UsageTile({ item }: { item: UsageItem }) {
  const label = tileLabel(item)
  const used = formatLimit(item.limit, item.used)
  const state = meterState(item)
  const note = state === 'ok' ? null : STATE[state]
  const max = item.max === null ? null : formatLimit(item.limit, item.max)
  return (
    <li
      data-slot="usage-meter"
      data-state={state}
      className={cn(
        'grid min-w-0 content-start gap-3 rounded-xl bg-card p-4 shadow-elevation-1',
        note && `ring-1 ${note.ring}`,
      )}
    >
      <span className="min-w-0 text-body-sm text-pretty text-muted-foreground">{label}</span>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums">
        <span className="text-page font-semibold tracking-[-0.02em]">{used}</span>
        <span className="text-body-sm text-muted-foreground">
          {max === null ? translate('ofUnlimited') : `of ${max}`}
        </span>
      </p>
      {max === null ? (
        <div aria-hidden className="h-1.5 rounded-full bg-muted" />
      ) : (
        <Meter
          label={translate('of4', {
            label: label,
            used: used,
            max: max,
            value4: note ? `, ${note.text.toLowerCase()}` : '',
          })}
          value={item.used}
          max={item.max ?? 0}
        />
      )}
      {note && (
        <span className={cn('-mt-1 text-caption font-medium', note.className)}>{note.text}</span>
      )}
    </li>
  )
}
