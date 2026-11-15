import { FaqSection } from '@/components/faq'
import { Features } from '@/components/home/features'
import { HeidiSection } from '@/components/home/heidi-section'
import { Hero } from '@/components/home/hero'
import { Standards } from '@/components/home/standards'
import { Steps } from '@/components/home/steps'
import { Trust } from '@/components/home/trust'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { GENERAL_FAQ } from '@/lib/faq'
import { translate } from '@/lib/i18n'
import { YEARLY_DISCOUNT_PERCENT } from '@/lib/plans'

export default function HomePage() {
  return (
    <main>
      <Hero />
      <Standards />
      <Features />
      <HeidiSection />
      <Steps />
      <Trust />
      <section id="pricing" className="py-12 sm:py-16">
        <Container>
          <SectionHeading
            eyebrow={translate('pricing')}
            title={
              <>
                {translate('simplePlans')}
                <span className="accent">{translate('onePrice')}</span>
                {translate('perPerson')}
              </>
            }
            lead={translate('eachTeamMemberPaysThePlanSPriceStart', {
              YEARLY_DISCOUNT_PERCENT: YEARLY_DISCOUNT_PERCENT,
            })}
          />
          <div className="mt-12">
            <PricingCards />
          </div>
        </Container>
      </section>
      <FaqSection
        id="faq"
        eyebrow={translate('questions')}
        title={
          <>
            {translate('goodTo')}
            <span className="accent">{translate('know')}</span>
          </>
        }
        lead={translate('whatPeopleAskBeforeTheyMoveTheirBooksTo')}
        card={{
          title: translate('heidiAnswersTheRest'),
          body: translate('insideHelvetlyPressJOnAnyPageAndAsk'),
          href: '/security',
          link: translate('howHeidiTreatsYourData'),
        }}
        items={GENERAL_FAQ}
      />
    </main>
  )
}
