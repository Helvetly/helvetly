'use client'
import { publicHref } from '@helvetly/i18n/public-href'
import { BillingIntervalToggle } from '@helvetly/ui/components/billing-interval-toggle'
import { Callout } from '@helvetly/ui/components/callout'
import { useLanguage, useTranslate } from '@helvetly/ui/components/language-provider'
import { FreePlanRow, PlanCard, PlanPrice } from '@helvetly/ui/components/plan-card'
import { freePlanFacts, planCards, planFootnote } from '@helvetly/ui/lib/plan-features'
import { formatPrice, yearlyFreeMonths } from '@helvetly/ui/lib/price'
import { ArrowDown, Ban, Globe, RefreshCw, Sparkles, UsersRound } from 'lucide-react'
import Link from 'next/link'

import { Cta } from '@/components/cta'
import { useOfferStatus } from '@/components/offer-provider'
import { useBillingInterval } from '@/lib/billing-interval'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/lib/currency'
import { translatorFor } from '@/lib/i18n'
import { planCatalogue, projectPlans } from '@/lib/offer'
import { type PlanId, plansIn, RECOMMENDED, TRIAL, YEARLY_DISCOUNT_PERCENT } from '@/lib/plans'
import { siteIn, SUPPORT_EMAIL } from '@/lib/site'
import { type Tone, TONES } from '@/lib/tones'

// Each plan on its own muted pastel, Free plain; Pro, the recommended plan, lilac as Heidi's band.
const PLAN_TONE: Record<PlanId, Tone | null> = {
  free: null,
  basic: 'sky',
  pro: 'lilac',
  business: 'mint',
}
export const planTone = (plan: PlanId) => {
  const tone = PLAN_TONE[plan]
  return tone ? cn(TONES[tone].tile, TONES[tone].border) : 'border-site-line bg-card'
}

const PUBLISHED = projectPlans().plans

/** A plan's prices as the API publishes them; the figures are the same in every currency. */
export function publishedPrices(plan: PlanId) {
  const prices = PUBLISHED.find((p) => p.id === plan)?.prices.CHF
  if (!prices) throw new Error(`no published price for ${plan}`)
  return prices
}

/** The call to action of a plan: Free starts free, Pro starts its trial, the others are chosen. */
export function PlanCta({
  plan,
  arrow,
  short = false,
  className,
}: {
  plan: PlanId
  arrow?: boolean
  /** The comparison's one-line label: "Try Pro free", no trial length (the cards above say it). */
  short?: boolean
  className?: string
}) {
  const language = useLanguage()
  const translate = useTranslate()
  const unavailable = useOfferStatus().status === 'unavailable'
  const name = plansIn(language).planById(plan).name
  return (
    <Cta
      href={siteIn(language).START_URL}
      disabled={unavailable && plan !== 'free'}
      variant={plan === RECOMMENDED ? 'primary' : 'outline'}
      arrow={short ? false : arrow}
      className={cn('w-full', short && 'whitespace-nowrap', className)}
    >
      {plan === 'free'
        ? translate('planStartFree')
        : plan === TRIAL.plan
          ? short
            ? translate('planTryFreeShort', { plan: name })
            : translate('planTryFree', { plan: name, days: TRIAL.days })
          : translate('planChoose', { plan: name })}
    </Cta>
  )
}

function Unavailable() {
  const translate = useTranslate()
  // Holds the price's height, so the cards keep their rhythm without a figure.
  return (
    <p className="flex h-[92px] items-start pt-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-foreground/25 px-3.5 py-1.5 text-body font-medium">
        <Ban aria-hidden className="size-4" />
        {translate('planPriceUnavailable')}
      </span>
    </p>
  )
}

export function PricingCards() {
  const language = useLanguage()
  const translate = translatorFor(language)
  const ui = useTranslate()
  const { planById } = plansIn(language)
  const catalogue = planCatalogue(language)
  // Free is the small row under the paid plans, not a fourth card.
  const cards = planCards(catalogue, language).filter((card) => card.plan !== 'free')
  const free = publishedPrices('free')
  const [interval, setInterval] = useBillingInterval()
  const currency = useCurrency()
  const offer = useOfferStatus()
  const unavailable = offer.status === 'unavailable'
  // What yearly gives as free months of Pro, from the published prices.
  const freeMonths = yearlyFreeMonths(
    PUBLISHED.map((plan) => ({
      ...publishedPrices(plan.id),
      id: plan.id,
      name: planById(plan.id).name,
    })),
  )
  const saving =
    freeMonths && ui('planYearlyFreeMonths', { ...freeMonths, over: String(freeMonths.over) })

  return (
    <div className="flex flex-col items-center">
      <BillingIntervalToggle
        value={interval}
        onValueChange={setInterval}
        discount={YEARLY_DISCOUNT_PERCENT}
        saving={unavailable ? undefined : saving}
      />

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

      <div className="mt-10 grid w-full items-stretch gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <PlanCard
            key={card.plan}
            data={card}
            featured={card.plan === RECOMMENDED}
            className={planTone(card.plan)}
            badge={
              card.plan === RECOMMENDED && (
                <span className="rounded-full bg-linear-to-r from-heidi-from to-heidi-to px-2.5 py-0.5 text-caption font-medium text-white">
                  {ui('planRecommended')}
                </span>
              )
            }
            price={
              unavailable ? (
                <Unavailable />
              ) : (
                <PlanPrice
                  prices={publishedPrices(card.plan)}
                  interval={interval}
                  currency={currency}
                />
              )
            }
            cta={<PlanCta plan={card.plan} />}
          />
        ))}
      </div>
      <FreePlanRow
        className="mt-4"
        name={ui('planFreeHeadline')}
        summary={ui('planFreeSummary', {
          price: formatPrice({ amount: free.month, currency }),
          count: free.included_people,
        })}
        facts={freePlanFacts(catalogue, language)}
        action={<PlanCta plan="free" arrow className="md:w-auto" />}
      />
      <Link
        href={`${publicHref('/pricing', language)}#compare-plans`}
        className="mt-6 inline-flex items-center gap-1.5 text-body font-medium underline underline-offset-4"
      >
        {ui('planCompareAll')}
        <ArrowDown aria-hidden className="size-4" />
      </Link>
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
          { icon: UsersRound, tone: TONES.sky, text: translate('stripPerPerson') },
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
