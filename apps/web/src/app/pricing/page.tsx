import { localizedAlternates } from '@helvetly/i18n'
import type { Metadata } from 'next'

import { FaqSection } from '@/components/faq'
import { OfferProvider } from '@/components/offer-provider'
import { PageHero } from '@/components/page-hero'
import { PlanTable } from '@/components/plan-table'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { PRICING_FAQ } from '@/lib/faq'
import { translate } from '@/lib/i18n'
import { TRIAL } from '@/lib/plans'
import { START_URL } from '@/lib/site'

export const metadata: Metadata = {
  alternates: localizedAlternates('/pricing'),
  title: translate('pricing'),
  description: translate('basicProAndBusinessComparedWhatEachPlanIncludes'),
}

export default function PricingPage() {
  return (
    <main>
      <PageHero
        eyebrow={translate('pricing')}
        title={
          <>
            {translate('clearPrices')}
            <span className="accent">{translate('perPerson2')}</span>
          </>
        }
        lead={translate('everyTeamMemberIsBilledAtThePlanS')}
      />
      <OfferProvider>
        <section className="pb-8">
          <Container>
            <PricingCards />
          </Container>
        </section>
        <section id="compare-plans" className="scroll-mt-24 pt-16 pb-24">
          <Container>
            <SectionHeading
              eyebrow={translate('comparePlans')}
              title={translate('whatEachPlanIncludes')}
              lead={translate('seeWhatIsIncludedAndWhatIsNotBefore')}
            />
            <div data-reveal className="mt-12">
              <PlanTable />
            </div>
          </Container>
        </section>
      </OfferProvider>
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
          title: translate('tryBusinessForDays', { days: TRIAL.days }),
          body: translate('upToPeopleWithSmallerTrialAllowancesThenPick', {
            members: TRIAL.members,
          }),
          href: START_URL,
          link: translate('startYourFreeTrial'),
        }}
        items={PRICING_FAQ}
      />
    </main>
  )
}
