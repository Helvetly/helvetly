'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Callout } from '@helvetly/ui/components/callout'
import { useLanguage } from '@helvetly/ui/components/language-provider'
import { PlanFeatureText } from '@helvetly/ui/components/plan-feature-text'
import { segmentLabels } from '@helvetly/ui/components/segmented'
import { planFootnote } from '@helvetly/ui/lib/plan-features'
import { formatAmount, formatPrice, monthOf } from '@helvetly/ui/lib/price'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { Ban, Check, Globe, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import { useState } from 'react'

import { Cta } from '@/components/cta'
import { useOfferStatus } from '@/components/offer-provider'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/lib/currency'
import { translatorFor } from '@/lib/i18n'
import { planLines } from '@/lib/offer'
import {
  type Interval,
  plansIn,
  priceOf,
  RECOMMENDED,
  TRIAL,
  YEARLY_DISCOUNT_PERCENT,
} from '@/lib/plans'
import { siteIn, SUPPORT_EMAIL } from '@/lib/site'
import { TONES } from '@/lib/tones'

// Basic and Business sit on their own pastel; Pro, the recommended plan, is the night card, as Heidi's band.
const PLAN_TONE = { basic: TONES.sky, pro: TONES.lilac, business: TONES.mint }

export function PricingCards() {
  const language = useLanguage()
  const translate = translatorFor(language)
  const { PLANS } = plansIn(language)
  const lines = planLines(language)
  const [interval, setInterval] = useState<Interval>('year')
  const currency = useCurrency()
  const offer = useOfferStatus()
  const unavailable = offer.status === 'unavailable'

  return (
    <div className="flex flex-col items-center">
      <fieldset className={cn(segmentTrack, 'inline-flex h-10')}>
        <legend className="sr-only">{translate('billingInterval')}</legend>
        {(['month', 'year'] as const).map((value) => (
          <label key={value} className={cn(segmentItem, 'h-8 gap-0 px-4')}>
            <input
              type="radio"
              name="interval"
              value={value}
              checked={interval === value}
              onChange={() => setInterval(value)}
              className="absolute inset-0 cursor-pointer appearance-none opacity-0"
            />
            {segmentLabels(value === 'month' ? translate('monthly') : translate('yearly'))}
            {/* The space is for the spoken name: "Yearly −20%". */}
            {value === 'year' && ' '}
            {value === 'year' && (
              <Badge tone="green" size="sm" className="ml-1.5">
                −{YEARLY_DISCOUNT_PERCENT}%
              </Badge>
            )}
          </label>
        ))}
      </fieldset>

      {unavailable && (
        <Callout
          role="alert"
          tone="warning"
          title={translate('pricingIsTemporarilyUnavailable')}
          className="mt-8 w-full max-w-3xl text-left max-sm:flex-wrap"
          actions={
            <button
              type="button"
              onClick={offer.retry}
              disabled={offer.checking}
              aria-busy={offer.checking}
              className="hover:bg-lilac inline-flex h-9 items-center gap-2 rounded-full border border-foreground/15 bg-card px-4 font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait"
            >
              <RefreshCw
                aria-hidden
                className={cn(
                  'size-4',
                  offer.checking && 'animate-spin motion-reduce:animate-none',
                )}
              />
              {offer.checking ? translate('checking') : translate('retry')}
            </button>
          }
        >
          {translate('tryAgainInAMomentOrWriteTo')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          .
        </Callout>
      )}

      <div className="mt-12 grid w-full gap-4 lg:grid-cols-3">
        {PLANS.map((plan, i) => {
          const featured = plan.id === RECOMMENDED
          const included = lines[i]
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
                // Holds the price row's height, so the cards keep their rhythm without a figure.
                <p className="mt-6 flex h-11 items-center">
                  <span
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border border-dashed px-3.5 py-1.5 text-body font-medium',
                      featured
                        ? 'border-white/40 text-white'
                        : 'border-foreground/25 text-foreground',
                    )}
                  >
                    <Ban aria-hidden className="size-4" />
                    {translate('priceUnavailable')}
                  </span>
                </p>
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
                    {formatAmount(
                      interval === 'year'
                        ? monthOf(priceOf(plan, 'year', currency))
                        : priceOf(plan, 'month', currency),
                    )}
                  </span>
                  <span
                    className={cn('text-body', featured ? 'opacity-70' : 'text-muted-foreground')}
                  >
                    {translate('personMonth')}
                  </span>
                </p>
              )}
              <p
                className={cn(
                  'mt-2 min-h-5 text-body-sm',
                  featured ? 'opacity-60' : 'text-muted-foreground',
                )}
              >
                {unavailable ? (
                  ''
                ) : interval === 'year' ? (
                  <>
                    <strong>{formatPrice(priceOf(plan, 'year', currency))}</strong>
                    {translate('annualPriceSuffix')}
                  </>
                ) : (
                  translate('billedMonthly')
                )}
              </p>
              <Cta
                href={siteIn(language).START_URL}
                disabled={unavailable}
                variant={featured ? 'light' : 'primary'}
                className="mt-6 w-full"
              >
                {translate('choose3')}
                {plan.name}
              </Cta>
              {included?.basis && <p className="mt-7 text-body font-medium">{included.basis}</p>}
              <ul className={cn('grid gap-2.5 text-body', included?.basis ? 'mt-3' : 'mt-7')}>
                {included?.lines.map((line) => (
                  <li key={line.key} className="flex gap-2.5">
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
                    <PlanFeatureText line={line} />
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
      <p
        data-slot="allowance-legend"
        className="mt-8 max-w-3xl text-center text-body-sm text-pretty text-muted-foreground"
      >
        {planFootnote(language)}
      </p>
      <ul className="mt-14 grid w-full max-w-5xl gap-x-6 gap-y-4 text-body-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Sparkles,
            tone: TONES.lilac,
            text: translate('stripTrial', { days: TRIAL.days, members: TRIAL.members }),
          },
          {
            icon: UsersRound,
            tone: TONES.sky,
            text: translate('stripPerPerson'),
          },
          { icon: Globe, tone: TONES.mint, text: translate('stripCurrencies') },
          { icon: RefreshCw, tone: TONES.peach, text: translate('stripCancel') },
        ].map(({ icon: Icon, tone, text }) => (
          <li key={text} className="flex items-center gap-3">
            <span
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-xl',
                tone.surface,
                tone.ink,
              )}
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <span className="text-muted-foreground">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
