'use client'
import { formatAmount, formatPrice, monthOf } from '@helvetly/ui/lib/price'
import { Check, Minus } from 'lucide-react'
import { useState } from 'react'

import { Cta } from '@/components/cta'
import { useOfferStatus } from '@/components/offer-provider'
import { cn } from '@/lib/cn'
import { taxNote, useCurrency } from '@/lib/currency'
import { translate } from '@/lib/i18n'
import {
  type Interval,
  MAX_SELF_SERVICE_SEATS,
  PLANS,
  priceOf,
  RECOMMENDED,
  TRIAL,
  YEARLY_DISCOUNT_PERCENT,
} from '@/lib/plans'
import { START_URL, SUPPORT_EMAIL } from '@/lib/site'
import { TONES } from '@/lib/tones'

// Basic and Business sit on their own pastel; Pro, the recommended plan, is the night card, as Heidi's band.
const PLAN_TONE = { basic: TONES.sky, pro: TONES.lilac, business: TONES.mint }

export function PricingCards() {
  const [interval, setInterval] = useState<Interval>('year')
  const currency = useCurrency()
  const offer = useOfferStatus()
  const unavailable = offer.status === 'unavailable'

  return (
    <div className="flex flex-col items-center">
      <fieldset className="border-site-line bg-site-tint inline-flex rounded-full border p-1 text-body-sm font-medium">
        <legend className="sr-only">{translate('billingInterval')}</legend>
        {(['month', 'year'] as const).map((value) => (
          <label
            key={value}
            className={cn(
              'relative inline-flex items-center rounded-full px-4 py-1.5 transition-colors has-checked:bg-card has-checked:shadow-elevation-1 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:has-checked:bg-white/15',
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
            {value === 'month' ? translate('monthly') : translate('yearly')}
            {value === 'year' && (
              <span className="ml-1.5 rounded-full bg-brand-surface px-1.5 py-0.5 text-caption text-brand">
                −{YEARLY_DISCOUNT_PERCENT}%
              </span>
            )}
          </label>
        ))}
      </fieldset>

      {unavailable && (
        <output className="border-site-line bg-site-tint mt-8 flex w-full max-w-3xl flex-col items-center justify-between gap-3 rounded-2xl border px-5 py-4 text-center text-body-sm sm:flex-row sm:text-left">
          <span>
            <span className="font-medium">{translate('pricingIsTemporarilyUnavailable')}</span>{' '}
            <span className="text-muted-foreground">
              {translate('tryAgainInAMomentOrWriteTo')}{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>
              .
            </span>
          </span>
          <button
            type="button"
            onClick={offer.retry}
            disabled={offer.checking}
            className="hover:bg-lilac inline-flex h-9 shrink-0 items-center rounded-full border border-foreground/15 bg-card px-4 font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60"
          >
            {offer.checking ? translate('checking') : translate('retry')}
          </button>
        </output>
      )}

      <div className="mt-12 grid w-full gap-4 lg:grid-cols-3">
        {PLANS.map((plan, i) => {
          const featured = plan.id === RECOMMENDED
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
                    {translate('recommended')}
                  </span>
                )}
              </div>
              <p className="mt-2 text-body font-medium">{plan.tagline}</p>
              <p
                className={cn(
                  'mt-1 min-h-12 text-body',
                  featured ? 'opacity-70' : 'text-muted-foreground',
                )}
              >
                {plan.pitch}
              </p>
              {unavailable ? (
                <p className="mt-6 text-title font-semibold">{translate('priceUnavailable')}</p>
              ) : (
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span
                    className={cn('text-body', featured ? 'opacity-70' : 'text-muted-foreground')}
                  >
                    {currency.toUpperCase()}
                  </span>
                  <span
                    key={interval}
                    className="pop text-price font-semibold tracking-tight tabular-nums"
                  >
                    {formatAmount(priceOf(plan, interval, currency))}
                  </span>
                  <span
                    className={cn('text-body', featured ? 'opacity-70' : 'text-muted-foreground')}
                  >
                    {translate('person')}
                    {interval}
                  </span>
                </p>
              )}
              <p
                className={cn(
                  'mt-2 h-5 text-body-sm',
                  featured ? 'opacity-60' : 'text-muted-foreground',
                )}
              >
                {unavailable
                  ? ''
                  : interval === 'year'
                    ? translate('aMonthBilledYearly', {
                        value1: formatPrice(monthOf(priceOf(plan, 'year', currency))),
                        value2: taxNote(currency),
                      })
                    : translate('billedMonthly', { value1: taxNote(currency) })}
              </p>
              <Cta
                href={START_URL}
                disabled={unavailable}
                variant={featured ? 'light' : 'primary'}
                className="mt-6 w-full"
              >
                {translate('choose3')}
                {plan.name}
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
                {plan.excludes.map((item) => (
                  <li
                    key={item}
                    className={cn(
                      'flex gap-2.5',
                      featured ? 'opacity-60' : 'text-muted-foreground',
                    )}
                  >
                    <span className="mt-0.5 inline-flex size-4.5 shrink-0 items-center justify-center">
                      <Minus aria-hidden className="size-3.5" />
                    </span>
                    <span>
                      <span className="sr-only">{translate('notIncluded2')}</span>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
      <p className="mt-10 max-w-3xl text-center text-body-sm text-muted-foreground">
        {translate('pricesArePerPersonEveryTeamMemberIsBilled')}
        {MAX_SELF_SERVICE_SEATS}
        {translate('peopleInTheAppWhatEachPersonAddsGoes')}
        {TRIAL.days}
        {translate('daysWithUpTo')}
        {TRIAL.members}
        {translate('peoplePricesAreInCHFInSwitzerlandAndLiechtenstein')}
      </p>
    </div>
  )
}
