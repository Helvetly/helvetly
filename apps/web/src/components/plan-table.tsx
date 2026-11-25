'use client'

import { useLanguage, useTranslate } from '@helvetly/ui/components/language-provider'
import { PlanHeadPrice } from '@helvetly/ui/components/plan-card'
import { PlanComparison } from '@helvetly/ui/components/plan-comparison'
import { planComparison, planFootnote } from '@helvetly/ui/lib/plan-features'

import { useOfferStatus } from '@/components/offer-provider'
import { PlanCta, publishedPrices } from '@/components/pricing-cards'
import { useBillingInterval } from '@/lib/billing-interval'
import { useCurrency } from '@/lib/currency'
import { planCatalogue } from '@/lib/offer'
import { type PlanId, plansIn, RECOMMENDED } from '@/lib/plans'

/** The monthly equivalent in a column header. */
function HeadPrice({ plan }: { plan: PlanId }) {
  const translate = useTranslate()
  const [interval] = useBillingInterval()
  const currency = useCurrency()
  if (useOfferStatus().status === 'unavailable' && plan !== 'free')
    return (
      <p className="mt-1 text-body-sm text-muted-foreground">{translate('planPriceUnavailable')}</p>
    )
  return <PlanHeadPrice prices={publishedPrices(plan)} interval={interval} currency={currency} />
}

/** Every feature and allowance of the plans side by side, from the same rows as the cards. */
export function PlanTable() {
  const language = useLanguage()
  const { PLANS, planById } = plansIn(language)
  return (
    <div className="flex flex-col gap-6">
      <PlanComparison
        groups={planComparison(
          planCatalogue(language),
          language,
          (id) => planById(id).includedPeople,
        )}
        featured={RECOMMENDED}
        stickyTop="top-20"
        surface="bg-(--site)"
        plans={PLANS.map((plan) => ({
          id: plan.id,
          name: plan.name,
          head: (
            <>
              <HeadPrice plan={plan.id} />
              <PlanCta plan={plan.id} short className="mt-3 min-h-9 px-4 py-1.5 text-body-sm" />
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
