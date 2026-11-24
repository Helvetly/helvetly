'use client'

import type { BillingInterval } from '@helvetly/ui/components/billing-interval-toggle'
import { useTranslate } from '@helvetly/ui/components/language-provider'
import type { PlanCardData } from '@helvetly/ui/lib/plan-features'
import {
  formatAmount,
  formatPrice,
  monthOf,
  type Price,
  YEARLY_DISCOUNT_PERCENT,
} from '@helvetly/ui/lib/price'
import { cn } from '@helvetly/ui/lib/utils'
import { Check } from 'lucide-react'
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
 * A plan's price: "CHF 49 / month", then "2 people included · +CHF 15 per extra person / month" and how it is billed;
 * yearly shows the month's share of the year and what the year saves, the extra person still at its monthly price with
 * ", billed yearly −20%". Free: "CHF 0" and "1 person · free forever". The
 * figure crossfades when the interval changes (not with reduced motion).
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
  // An extra person reads as its monthly price either way; yearly adds the discount, never a second figure.
  const extra = price(prices.extra_person_month)
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
      <p className="mt-1.5 text-body-sm text-foreground">
        {free
          ? translate('planFreeForever', { count: prices.included_people })
          : translate('planPeopleIncluded', {
              count: prices.included_people,
              extra: formatPrice(extra),
              yearly: String(yearly),
              percent: YEARLY_DISCOUNT_PERCENT,
            })}
      </p>
      <p className="mt-0.5 min-h-[18px] text-body-sm text-muted-foreground">
        {free
          ? translate('planNoCard')
          : yearly
            ? translate('planBilledYearly', {
                price: formatPrice(price(prices.year)),
                saving: formatPrice(price(prices.month * 12 - prices.year)),
              })
            : translate('planBilledMonthly')}
      </p>
    </div>
  )
}

const tick = (
  <span className="mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-success-surface text-success">
    <Check aria-hidden className="size-3" />
  </span>
)

/**
 * One plan: its name, headline and who it is for, the price and the call to action, then its lead features in bold,
 * the rest by group, muted, and its allowances as a small two-column table.
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
      <p className="mt-1 text-body font-medium text-balance">{data.headline}</p>
      <p className="mt-1 min-h-10 text-body-sm text-pretty text-muted-foreground">{data.bestFor}</p>
      <div className="mt-5">{price}</div>
      <div className="mt-5">{cta}</div>

      {data.heroes.length > 0 && (
        <ul className="mt-6 grid gap-2 text-body font-medium">
          {data.heroes.map((line) => (
            <li key={line.key} className="flex gap-2.5">
              {tick}
              <span>{line.label}</span>
            </li>
          ))}
        </ul>
      )}
      {data.basis && <p className="mt-6 text-body-sm font-medium">{data.basis}</p>}
      {data.groups.map((group) => (
        <div key={group.group} className="mt-4">
          <h4 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </h4>
          <ul className="mt-1.5 grid gap-1.5 text-body-sm text-muted-foreground">
            {group.lines.map((line) => (
              <li key={line.key} className="flex gap-2">
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
                <span>{line.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <dl
        aria-label={translate('planLimitsTitle')}
        className="mt-auto grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-border/70 pt-4 text-body-sm [&:not(:first-child)]:mt-6"
      >
        {data.limits.map((limit) => (
          <div key={limit.key} className="contents">
            <dt className="text-muted-foreground">{limit.label}</dt>
            <dd className="text-right font-medium tabular-nums">{limit.amount}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

/**
 * Free as one calm row under the paid plans (stacked on phones): its name and "CHF 0 · 1 person · no card needed",
 * a few facts inline and one action (or a badge such as "Your current plan").
 */
export function FreePlanRow({
  name,
  summary,
  facts,
  badge,
  action,
  className,
}: {
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
        'grid w-full gap-3 rounded-2xl border bg-card px-5 py-4 text-left md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-6',
        className,
      )}
    >
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="plan-free" className="text-title-sm font-semibold">
            {name}
          </h3>
          {badge}
        </div>
        <p className="text-body-sm text-muted-foreground tabular-nums">{summary}</p>
      </div>
      <ul
        aria-label={translate('planFreeFactsLabel')}
        className="flex flex-wrap gap-x-4 gap-y-1.5 text-body-sm text-muted-foreground"
      >
        {facts.map((fact) => (
          <li key={fact} className="flex items-center gap-1.5">
            <Check aria-hidden className="size-3.5 shrink-0 text-success" />
            {fact}
          </li>
        ))}
      </ul>
      {action && <div className="md:justify-self-end">{action}</div>}
    </section>
  )
}
