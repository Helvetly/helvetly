'use client'

import { useLanguage, useTranslate } from '@helvetly/ui/components/language-provider'
import { PlanComparison } from '@helvetly/ui/components/plan-comparison'
import { planComparison, planFootnote } from '@helvetly/ui/lib/plan-features'
import { formatPrice, monthOf } from '@helvetly/ui/lib/price'

import { useOfferStatus } from '@/components/offer-provider'
import { PlanCta, publishedPrices } from '@/components/pricing-cards'
import { useBillingInterval } from '@/lib/billing-interval'
import { useCurrency } from '@/lib/currency'
import { planCatalogue } from '@/lib/offer'
import { type PlanId, plansIn, RECOMMENDED } from '@/lib/plans'

/** The price in a column's pinned head: a month's price (yearly: its share of the year) for the included people. */
function HeadPrice({ plan }: { plan: PlanId }) {
  const translate = useTranslate()
  const [interval] = useBillingInterval()
  const currency = useCurrency()
  if (useOfferStatus().status === 'unavailable' && plan !== 'free')
    return translate('planPriceUnavailable')
  const prices = publishedPrices(plan)
  const month =
    interval === 'year'
      ? monthOf({ amount: prices.year, currency })
      : { amount: prices.month, currency }
  return (
    <>
      {formatPrice(month)} {prices.month > 0 && translate('planPerMonth')}
    </>
  )
}

/** Every feature and allowance of the plans side by side, from the same rows as the cards. */
export function PlanTable() {
  const language = useLanguage()
  const { PLANS } = plansIn(language)
  return (
    <div className="flex flex-col gap-6">
      <PlanComparison
        groups={planComparison(planCatalogue(language), language)}
        featured={RECOMMENDED}
        stickyTop="top-20"
        plans={PLANS.map((plan) => ({
          id: plan.id,
          name: plan.name,
          head: (
            <>
              <span className="mt-1 block text-body-sm font-normal text-muted-foreground tabular-nums">
                <HeadPrice plan={plan.id} />
              </span>
              <PlanCta plan={plan.id} className="mt-3 min-h-9 px-4 py-1.5 text-body-sm" />
            </>
          ),
        }))}
      />
      <p
        data-slot="allowance-legend"
        className="mx-auto max-w-3xl text-center text-body-sm text-muted-foreground"
      >
        {planFootnote(language)}
      </p>
    </div>
  )
}
