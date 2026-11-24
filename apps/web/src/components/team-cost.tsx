'use client'
import { publicHref } from '@helvetly/i18n/public-href'
import { BillingIntervalToggle } from '@helvetly/ui/components/billing-interval-toggle'
import { useLanguage, useTranslate } from '@helvetly/ui/components/language-provider'
import { Slider } from '@helvetly/ui/components/slider'
import { YEARLY_DISCOUNT_PERCENT } from '@helvetly/ui/lib/price'
import { useState } from 'react'

import { useOfferStatus } from '@/components/offer-provider'
import { cn } from '@/lib/cn'
import { translatorFor } from '@/lib/i18n'
import { type Interval, plansIn, RECOMMENDED } from '@/lib/plans'
import { TEAM_SIZE, teamCost } from '@/lib/team-cost'
import { PRO_TRIAL_DAYS } from '@/lib/team-pricing'

/** The other product's prices as read on its site, quoted beside ours rather than recomputed for a team. */
export type TheirPrices = {
  name: string
  url: string
  price: string
  pricingModel: string
  pricesChecked: string
}

/** What Helvetly costs for a team of one to ten, monthly or yearly, beside what the other product charges for. */
export function TeamCost({ them }: { them: TheirPrices }) {
  const language = useLanguage()
  const translate = translatorFor(language)
  const ui = useTranslate()
  const PLANS = plansIn(language).PLANS.filter((plan) => plan.id !== 'free') // Free is for one person: no team cost
  const unavailable = useOfferStatus().status === 'unavailable'
  const [people, setPeople] = useState(TEAM_SIZE.start)
  const [interval, setInterval] = useState<Interval>('year')

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div data-reveal className="border-site-line bg-site-tint rounded-3xl border p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <BillingIntervalToggle value={interval} onValueChange={setInterval} />
          <p className="text-body font-medium tabular-nums" id="team-size">
            {translate('cmpTeamOf', { count: people })}
          </p>
        </div>
        <Slider
          aria-labelledby="team-size"
          min={TEAM_SIZE.min}
          max={TEAM_SIZE.max}
          step={1}
          value={[people]}
          onValueChange={([value]) => value !== undefined && setPeople(value)}
          className="mt-6"
        />
        <ul className="mt-7 grid gap-3">
          {PLANS.map((plan) => {
            const cost = teamCost(plan, people, interval, language)
            return (
              <li
                key={plan.id}
                data-plan={plan.id}
                className={cn(
                  'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-2xl bg-card px-5 py-4',
                  plan.id === RECOMMENDED && 'ring-1 ring-brand/30',
                )}
              >
                <span className="text-body font-semibold">{plan.name}</span>
                {unavailable ? (
                  <span className="text-body text-muted-foreground">
                    {translate('priceUnavailable')}
                  </span>
                ) : cost.fits ? (
                  <span className="text-right tabular-nums">
                    <span className="text-title-sm font-semibold">
                      {translate(interval === 'year' ? 'cmpPerYear' : 'cmpPerMonth', {
                        price: cost.total,
                      })}
                    </span>
                    <span className="block text-body-sm whitespace-nowrap">
                      {ui('planExtraPerson', { extra: cost.extraPerson })}
                    </span>
                    <span className="block text-body-sm text-muted-foreground">
                      {cost.saving
                        ? `${ui('planBilledYearly', { percent: YEARLY_DISCOUNT_PERCENT })} · ${ui('planYouSave', { saving: cost.saving })}`
                        : ui('planBilledMonthly')}
                    </span>
                  </span>
                ) : (
                  <span className="text-body text-muted-foreground">
                    {translate('cmpUpToPeople', { count: cost.seats })}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-5 text-body-sm text-muted-foreground">
          {translate('cmpOurPriceExplained', { days: PRO_TRIAL_DAYS })}{' '}
          <a
            href={publicHref('/pricing', language)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {translate('cmpWhatEachPlanIncludes')}
          </a>
        </p>
      </div>

      <div
        data-reveal
        style={{ ['--d' as string]: '100ms' }}
        className="border-site-line rounded-3xl border p-7"
      >
        <h3 className="text-title-sm font-semibold">
          {translate('cmpWhatTheyCharge', { name: them.name })}
        </h3>
        <p className="mt-4 text-body">{them.price}</p>
        <p className="mt-3 text-body text-muted-foreground">{them.pricingModel}</p>
        <p className="mt-5 text-body-sm text-muted-foreground">
          {translate('cmpTheirPricesExplained', { date: them.pricesChecked })}{' '}
          <a
            href={them.url}
            rel="noopener"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {new URL(them.url).hostname.replace(/^www\./, '')}
          </a>
        </p>
      </div>
    </div>
  )
}
