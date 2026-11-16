import { localizedHref } from '@helvetly/i18n'

import { FaqSection } from '@/components/faq'
import { Features } from '@/components/home/features'
import { HeidiSection } from '@/components/home/heidi-section'
import { Hero } from '@/components/home/hero'
import { Standards } from '@/components/home/standards'
import { Steps } from '@/components/home/steps'
import { Trust } from '@/components/home/trust'
import { OfferProvider } from '@/components/offer-provider'
import { PricingCards } from '@/components/pricing-cards'
import { Container, SectionHeading } from '@/components/section'
import { languageOf, translatorFor } from '@/lib/i18n'
import { YEARLY_DISCOUNT_PERCENT } from '@/lib/plans'

type Props = { params: Promise<{ lang?: string }> }

export default async function HomePage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  return (
    <main>
      <Hero lang={lang} />
      <Standards lang={lang} />
      <Features lang={lang} />
      <HeidiSection lang={lang} />
      <Steps lang={lang} />
      <Trust lang={lang} />
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
            <OfferProvider>
              <PricingCards />
            </OfferProvider>
          </div>
        </Container>
      </section>
      <FaqSection
        lang={lang}
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
          href: localizedHref('/security', lang),
          link: translate('howHeidiTreatsYourData'),
        }}
        teaser="home"
      />
    </main>
  )
}
