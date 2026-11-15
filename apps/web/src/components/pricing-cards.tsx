'use client'

import { formatAmount, formatPrice, monthOf } from '@helvetly/ui/lib/price'
import { Check } from 'lucide-react'
import { useState } from 'react'

import { Cta } from '@/components/cta'
import { cn } from '@/lib/cn'
import { type Interval, PLANS, priceOf, TRIAL_DAYS, YEARLY_DISCOUNT_PERCENT } from '@/lib/plans'
import { START_URL } from '@/lib/site'
import { TONES } from '@/lib/tones'

// Basic and Business sit on their own pastel; Pro is the night card, as Heidi's band.
const PLAN_TONE = { basic: TONES.sky, pro: TONES.lilac, business: TONES.mint }

const FEATURED = 'pro'

export function PricingCards() {
  const [interval, setInterval] = useState<Interval>('year')

  return (
    <div className="flex flex-col items-center">
      <fieldset className="border-site-line bg-site-tint inline-flex rounded-full border p-1 text-body-sm font-medium">
        <legend className="sr-only">Billing interval</legend>
        {(['month', 'year'] as const).map((value) => (
          <label
            key={value}
            className={cn(
              'relative inline-flex items-center rounded-full px-4 py-1.5 transition-colors has-checked:bg-card has-checked:shadow-elevation-1 dark:has-checked:bg-white/15 has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
              interval === value
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name="interval"
              value={value}
              checked={interval === value}
              onChange={() => setInterval(value)}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0"
            />
            {value === 'month' ? 'Monthly' : 'Yearly'}
            {value === 'year' && (
              <span className="ml-1.5 rounded-full bg-brand-surface px-1.5 py-0.5 text-caption text-brand">
                −{YEARLY_DISCOUNT_PERCENT}%
              </span>
            )}
          </label>
        ))}
      </fieldset>

      <div className="mt-12 grid w-full gap-4 lg:grid-cols-3">
        {PLANS.map((plan, i) => {
          const featured = plan.id === FEATURED
          return (
            <article
              key={plan.id}
              data-reveal
              style={{ ['--d' as string]: `${i * 100}ms` }}
              className={cn(
                'relative flex flex-col rounded-3xl p-7 text-left',
                featured
                  ? 'night ring-gradient text-white shadow-[0_40px_100px_-40px_rgb(85_39_201/0.7)] lg:-my-4 lg:py-11'
                  : cn('border', PLAN_TONE[plan.id].tile, PLAN_TONE[plan.id].border),
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-title font-semibold">{plan.name}</h3>
                {featured && (
                  <span className="rounded-full bg-linear-to-r from-heidi-from to-heidi-to px-2.5 py-0.5 text-caption font-medium text-white">
                    Most popular
                  </span>
                )}
              </div>
              <p
                className={cn(
                  'mt-2 min-h-12 text-body',
                  featured ? 'opacity-70' : 'text-muted-foreground',
                )}
              >
                {plan.pitch}
              </p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span
                  className={cn('text-body', featured ? 'opacity-70' : 'text-muted-foreground')}
                >
                  CHF
                </span>
                <span
                  key={interval}
                  className="pop text-price font-semibold tracking-tight tabular-nums"
                >
                  {formatAmount(priceOf(plan, interval))}
                </span>
                <span
                  className={cn('text-body', featured ? 'opacity-70' : 'text-muted-foreground')}
                >
                  / person / {interval}
                </span>
              </p>
              <p
                className={cn(
                  'mt-2 h-5 text-body-sm',
                  featured ? 'opacity-60' : 'text-muted-foreground',
                )}
              >
                {interval === 'year'
                  ? `${formatPrice(monthOf(priceOf(plan, 'year')))} a month, billed yearly, incl. VAT`
                  : 'Billed monthly, incl. VAT'}
              </p>
              <Cta
                href={START_URL}
                variant={featured ? 'light' : 'primary'}
                className="mt-6 w-full"
              >
                {plan.id === 'basic' ? `Start ${TRIAL_DAYS}-day trial` : `Choose ${plan.name}`}
              </Cta>
              <ul className="mt-7 grid gap-2.5 text-body">
                {plan.highlights.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center rounded-full',
                        featured
                          ? 'bg-white/15 text-white'
                          : cn(PLAN_TONE[plan.id].surface, PLAN_TONE[plan.id].ink),
                      )}
                    >
                      <Check aria-hidden className="size-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
      <p className="mt-10 max-w-3xl text-center text-body-sm text-muted-foreground">
        Every plan includes every feature: QR bills, reminders, e-invoicing, signatures, the client
        portal and Heidi. Prices are per person in the workspace; plans differ only in how much you
        can do.
      </p>
    </div>
  )
}
