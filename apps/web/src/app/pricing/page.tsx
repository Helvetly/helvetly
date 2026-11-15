import { localizedAlternates } from '@helvetly/i18n'
import type { Metadata } from 'next'

import { FaqSection } from '@/components/faq'
import { PageHero } from '@/components/page-hero'
import { PlanTable } from '@/components/plan-table'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { PRICING_FAQ } from '@/lib/faq'
import { translate } from '@/lib/i18n'
import { TRIAL_DAYS } from '@/lib/plans'
import { START_URL } from '@/lib/site'

export const metadata: Metadata = {
  alternates: localizedAlternates('/pricing'),

  title: translate('pricing'),
  description: translate('basicProAndBusinessPricesPerPersonInCHF'),
}

export default function PricingPage() {
  return (
    <main>
      <PageHero
        eyebrow={translate('pricing')}
        title={
          <>
            {translate('simplePrices')}
            <span className="accent">{translate('everyFeature')}</span>
          </>
        }
        lead={translate('youPayForEachTeamMemberAndEveryPlan')}
      />
      <section className="pb-24">
        <Container>
          <PricingCards />
        </Container>
      </section>
      <section id="compare-plans" className="py-24">
        <Container>
          <SectionHeading
            eyebrow={translate('comparePlans')}
            title={translate('whatEachPlanIncludes')}
            lead={translate('monthlyLimitsStartAgainOnTheFirstOfThe')}
          />
          <div data-reveal className="mt-12">
            <PlanTable />
          </div>
        </Container>
      </section>
      <FaqSection
        eyebrow={translate('billingQuestions')}
        title={
          <>
            {translate('beforeYou')}
            <span className="accent">{translate('choose')}</span>
          </>
        }
        lead={translate('trialsVATLimitsAndChangingPlansInShortAnswers')}
        card={{
          title: translate('everyFeatureFromTheFirstDay'),
          body: translate('startADayTrialWithTheWholeProductThen', { TRIAL_DAYS: TRIAL_DAYS }),
          href: START_URL,
          link: translate('startYourFreeTrial'),
        }}
        items={PRICING_FAQ}
      />
    </main>
  )
}
