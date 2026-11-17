import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Meter } from '@helvetly/ui/components/meter'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, Gauge, TrendingUp } from 'lucide-react'
import Link from 'next/link'

import { SettingsSection } from '@/components/settings/layout'
import {
  formatLimit,
  formatReset,
  isLimitKey,
  meterState,
  nextPlan,
  usageHint,
  usageItems,
  usageLabel,
  type Billing,
  type UsageItem,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

import { limitLine } from './plan-cards'

const STATE = {
  near: { text: translate('almostAtLimit'), className: 'text-warning' },
  full: { text: translate('limitReached'), className: 'text-destructive' },
}

/** How full an item is, 0–1+; an unlimited or uncounted item counts as empty. */
const share = (item: UsageItem) =>
  item.max === null || item.max === 0 || item.used === null ? -1 : item.used / item.max

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** "Signature requests this month" reads "Signature requests" under a "This month" note. */
const rowLabel = (item: UsageItem) => usageLabel(item.limit).replace(/ this month$/, '')

/**
 * The plan's usage as a compact list, two columns on a wide panel: a name, a slim bar and "used of
 * limit" per row. Limits the plan does not include are left out. One nudge to the next plan for the
 * item under the most pressure.
 */
export function UsageOverview({ billing }: { billing: Billing }) {
  const items = usageItems(billing).filter((item) => meterState(item) !== 'off')
  const pressing = items
    .filter((item) => ['near', 'full'].includes(meterState(item)))
    .toSorted((a, b) => share(b) - share(a))[0]
  return (
    <SettingsSection
      id="usage"
      icon={Gauge}
      title={translate('usage')}
      description={translate('usageSectionHint')}
    >
      <div data-slot="usage-overview" className="grid gap-3">
        <p className="text-body-sm text-muted-foreground tabular-nums">
          {billing.trial
            ? translate('forTheWholeTrial')
            : `${translate('thisMonthSince')}${formatDate(billing.period_start)}`}
        </p>
        {pressing && <UpgradeNudge billing={billing} item={pressing} />}
        <ul className="grid gap-x-10 divide-y @xl:grid-cols-2">
          {items.map((item) => (
            <UsageRow key={item.limit} item={item} trial={billing.trial} />
          ))}
        </ul>
      </div>
    </SettingsSection>
  )
}

/** The item closest to its limit, and what the next plan up gives instead. */
function UpgradeNudge({ billing, item }: { billing: Billing; item: UsageItem }) {
  const full = meterState(item) === 'full'
  const next = billing.enabled ? nextPlan(billing) : undefined
  const label = rowLabel(item)
  const key = isLimitKey(item.limit) ? item.limit : null
  // A full invoice allowance stops issuing only: drafts are saved and can be issued later.
  const kept =
    full && item.limit === 'invoices_per_month'
      ? ` ${translate('draftsStaySavedAndCanBeIssuedOnce')}`
      : ''
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
      </strong>
      {kept}{' '}
      {next && key
        ? translate('includes2', {
            name: next.name,
            value2: lowerFirst(limitLine(key, next.limits[key])),
          })
        : item.reset_at
          ? translate('theAllowanceResetsOn', { at: formatReset(item.reset_at) })
          : ''}
    </Callout>
  )
}

/**
 * Where the cap comes from and when it starts again. A trial's allowances neither reset nor grow with
 * people: its monthly counts are one pool for the whole trial.
 */
function rowFacts(item: UsageItem, trial: boolean): string[] {
  const facts = trial
    ? [item.limit.endsWith('_per_month') ? translate('forTheWholeTrial') : null]
    : [
        item.per_seat === undefined
          ? null
          : item.per_seat
            ? translate('perPaidPersonShared')
            : translate('perWorkspace'),
        item.reset_at && item.max !== 0
          ? translate('resets', { at: formatReset(item.reset_at) })
          : null,
      ]
  return facts.filter((fact): fact is string => fact !== null)
}

/**
 * One limit: its name (a help tip where the name alone does not say what counts), the count over its
 * limit, a slim bar (none when unlimited) and one muted note.
 */
function UsageRow({ item, trial = false }: { item: UsageItem; trial?: boolean }) {
  const label = rowLabel(item)
  const hint = usageHint(item.limit)
  const state = meterState(item)
  const used = item.used === null ? '—' : formatLimit(item.limit, item.used)
  const note = state === 'near' || state === 'full' ? STATE[state] : null
  const max = item.max === null ? null : formatLimit(item.limit, item.max)
  const notes = rowFacts(item, trial)
  if (item.used === null) notes.unshift(translate('notCountedYet'))
  return (
    <li
      data-slot="usage-meter"
      data-state={state}
      className="grid min-w-0 content-start gap-1.5 py-2.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-body-sm text-pretty">
          {label}
          {hint && <HelpTip label={label}>{hint}</HelpTip>}
        </span>
        <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
          <span className={cn('font-medium', note ? note.className : 'text-foreground')}>
            {used}
          </span>
          {max === null ? ` · ${translate('unlimited2')}` : ` ${translate('dynamicOf', { max })}`}
        </span>
      </div>
      {max !== null && item.used !== null && (
        <Meter
          label={translate('of4', {
            label,
            used,
            max,
            value4: note ? `, ${note.text.toLowerCase()}` : '',
          })}
          value={item.used}
          max={item.max ?? 0}
        />
      )}
      {(note || notes.length > 0 || item.custom) && (
        <span className="text-caption text-muted-foreground">
          {[
            note && (
              <span key="state" className={cn('font-medium', note.className)}>
                {note.text}
              </span>
            ),
            ...notes,
            item.custom && (
              <span key="custom" data-slot="usage-custom" className="font-medium text-brand">
                {item.custom.expires_at
                  ? translate('customLimitUntil', { date: formatDate(item.custom.expires_at) })
                  : translate('customLimit')}
              </span>
            ),
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}
        </span>
      )}
    </li>
  )
}
