'use client'

import type { BillingInterval } from '@helvetly/ui/components/billing-interval-toggle'
import { useTranslate } from '@helvetly/ui/components/language-provider'
import type { PlanCardData } from '@helvetly/ui/lib/plan-features'
import { formatAmount, formatPrice, monthOf, type Price } from '@helvetly/ui/lib/price'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, Rocket } from 'lucide-react'
import type { ReactNode } from 'react'

/** A plan's price as the offer publishes it, in minor units of one currency, tax included. */
export type PlanPrices = {
  month: number
  year: number
  included_people: number
  extra_person_month: number
  extra_person_year: number
}

/**
 * A plan's price in the comparison's pinned head, two short lines: what a month costs on the chosen interval (yearly:
 * its share of the year), then, muted, its people: "2 people incl., +CHF 15 each" (the extra person at its monthly
 * price, as on the cards), or Free's "1 person · free forever". The year's total and saving stay on the cards.
 */
export function PlanHeadPrice({
  prices,
  interval,
  currency,
}: {
  prices: PlanPrices
  interval: BillingInterval
  currency: string
}) {
  const translate = useTranslate()
  const month =
    interval === 'year'
      ? monthOf({ amount: prices.year, currency })
      : { amount: prices.month, currency }
  return (
    <div data-slot="plan-head-price" className="mt-1 text-body-sm tabular-nums">
      <p className="whitespace-nowrap">
        <span className="font-semibold text-foreground">{formatPrice(month)}</span>{' '}
        <span className="text-muted-foreground">{translate('planPerMonth')}</span>
      </p>
      {/* Two lines kept in the table, so every column's call to action sits at the same height. */}
      <p className="mt-0.5 text-balance text-muted-foreground lg:min-h-[2lh]">
        {prices.month === 0
          ? translate('planFreeForever', { count: prices.included_people })
          : translate('planPeopleShort', {
              count: prices.included_people,
              // A no-break space keeps "CHF 15" on one line.
              extra: formatPrice({ amount: prices.extra_person_month, currency }).replace(
                ' ',
                '\u00a0',
              ),
            })}
      </p>
    </div>
  )
}

/**
 * How a paid plan's people and billing read, under its price, each on one line: "1 person incl. · +CHF 10 / person"
 * (the extra person at its monthly price), then, muted, "CHF 470 / year · save CHF 118" or "Billed monthly".
 * `people` false leaves "1 person incl." out.
 */
export function PlanPriceTerms({
  prices,
  interval,
  currency,
  people = true,
  className,
}: {
  prices: PlanPrices
  interval: BillingInterval
  currency: string
  people?: boolean
  className?: string
}) {
  const translate = useTranslate()
  const price = (amount: number): Price => ({ amount, currency })
  const terms = [
    people && translate('planPeopleIncluded', { count: prices.included_people }),
    translate('planExtraPerson', { extra: formatPrice(price(prices.extra_person_month)) }),
  ]
  const billing =
    interval === 'year'
      ? [
          translate('planYearTotal', { price: formatPrice(price(prices.year)) }),
          translate('planYouSave', { saving: formatPrice(price(prices.month * 12 - prices.year)) }),
        ]
      : [translate('planBilledMonthly')]
  return (
    <div data-slot="plan-price-terms" className={cn('text-body-sm tabular-nums', className)}>
      <p className="text-foreground">{parts(terms)}</p>
      <p className="mt-0.5 text-muted-foreground">{parts(billing)}</p>
    </div>
  )
}

/** Parts joined by " · ", each kept on one line. */
function parts(list: (string | false)[]) {
  return list
    .filter((part) => part !== false)
    .map((part, index) => (
      <span key={part}>
        {index > 0 && ' · '}
        <span className="whitespace-nowrap">{part}</span>
      </span>
    ))
}

/**
 * A plan's price: "CHF 49 / month", then its people and billing (`PlanPriceTerms`); yearly shows the month's share of
 * the year. Free: "CHF 0", "1 person · free forever" and "No card needed". The figure crossfades when the interval
 * changes (not with reduced motion).
 */
export function PlanPrice({
  prices,
  interval,
  currency,
}: {
  prices: PlanPrices
  interval: BillingInterval
  currency: string
}) {
  const translate = useTranslate()
  const price = (amount: number): Price => ({ amount, currency })
  const free = prices.month === 0
  const yearly = interval === 'year' && !free
  const month = yearly ? monthOf(price(prices.year)) : price(prices.month)
  return (
    <div data-slot="plan-price">
      <p className="flex items-baseline gap-1.5">
        <span className="text-body text-muted-foreground">{currency.toUpperCase()}</span>
        <span
          key={`${interval}-${month.amount}`}
          className="animate-in text-display font-semibold tracking-tight tabular-nums duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
        >
          {formatAmount(month)}
        </span>
        {!free && (
          <span className="text-body text-muted-foreground">{translate('planPerMonth')}</span>
        )}
      </p>
      {free ? (
        <>
          <p className="mt-1.5 text-body-sm text-foreground">
            {translate('planFreeForever', { count: prices.included_people })}
          </p>
          <p className="mt-0.5 text-body-sm text-muted-foreground">{translate('planNoCard')}</p>
        </>
      ) : (
        <PlanPriceTerms
          prices={prices}
          interval={interval}
          currency={currency}
          className="mt-1.5"
        />
      )}
    </div>
  )
}

const tick = (
  <span className="mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-success-surface text-success">
    <Check aria-hidden className="size-3" />
  </span>
)

/**
 * One plan, compact: its name and tagline, the price, the call to action, five lead features at most and three key
 * allowances in one muted line. Everything else is in the comparison table.
 */
export function PlanCard({
  data,
  price,
  cta,
  badge,
  featured = false,
  className,
}: {
  data: PlanCardData
  price: ReactNode
  cta: ReactNode
  /** e.g. "Recommended", beside the name. */
  badge?: ReactNode
  featured?: boolean
  className?: string
}) {
  const translate = useTranslate()
  return (
    <article
      data-slot="plan-card"
      data-plan={data.plan}
      aria-labelledby={`plan-${data.plan}`}
      className={cn(
        'relative flex flex-col rounded-3xl border bg-card p-6 text-left',
        featured && 'border-violet-solid/35 ring-1 ring-violet-solid/25',
        className,
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 id={`plan-${data.plan}`} className="text-title font-semibold">
          {data.name}
        </h3>
        {badge}
      </div>
      <p className="mt-1 text-body-sm text-muted-foreground">{data.tagline}</p>
      <div className="mt-4">{price}</div>
      <div className="mt-5">{cta}</div>

      <ul data-slot="plan-features" className="mt-6 grid gap-2.5 text-body-sm">
        {data.features.map((line) => (
          <li
            key={line.key}
            className={cn('flex gap-2.5', line.key === 'everything' && 'font-medium')}
          >
            {tick}
            <span>{line.label}</span>
          </li>
        ))}
      </ul>

      <p
        data-slot="plan-stats"
        aria-label={translate('planStatsLabel')}
        className="mt-auto border-t border-border/70 pt-4 text-caption text-muted-foreground tabular-nums [&:not(:first-child)]:mt-6"
      >
        {parts(data.stats)}
      </p>
    </article>
  )
}

/**
 * Free as one calm, inviting row under the paid plans (stacked on phones): an icon, "Just starting? Start free." with
 * "CHF 0 forever · 1 person · no card needed" under it, a few facts as chips and one action (or a badge such as "Your
 * current plan").
 */
export function FreePlanRow({
  name,
  summary,
  facts,
  badge,
  action,
  className,
}: {
  /** The headline, e.g. "Just starting? Start free." or the plan's name. */
  name: string
  summary: string
  facts: string[]
  badge?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const translate = useTranslate()
  return (
    <section
      aria-labelledby="plan-free"
      data-slot="free-plan"
      data-plan="free"
      className={cn(
        'grid w-full gap-4 rounded-2xl border border-violet-solid/15 bg-linear-to-r from-violet-surface/60 via-card to-card px-5 py-4 text-left md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-6',
        className,
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-surface text-violet">
          <Rocket aria-hidden className="size-5" />
        </span>
        <div className="grid gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="plan-free" className="text-title-sm font-semibold">
              {name}
            </h3>
            {badge}
          </div>
          <p className="text-body-sm text-muted-foreground tabular-nums">{summary}</p>
        </div>
      </div>
      <ul
        aria-label={translate('planFreeFactsLabel')}
        className="flex flex-wrap gap-2 md:justify-center"
      >
        {facts.map((fact) => (
          <li
            key={fact}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/80 px-3 py-1 text-caption text-muted-foreground"
          >
            <Check aria-hidden className="size-3 shrink-0 text-success" />
            {fact}
          </li>
        ))}
      </ul>
      {action && <div className="md:justify-self-end">{action}</div>}
    </section>
  )
}
