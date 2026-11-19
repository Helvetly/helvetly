import { localizedHref } from '@helvetly/i18n'

import { FaqSection } from '@/components/faq'
import { About } from '@/components/home/about'
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
import { SITE_URL } from '@/lib/metadata'
import { plansIn, YEARLY_DISCOUNT_PERCENT } from '@/lib/plans'

type Props = { params: Promise<{ lang?: string }> }

export default async function HomePage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const { PLANS } = plansIn(lang)
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Helvetly',
        url: SITE_URL,
        logo: `${SITE_URL}/apple-icon.png`,
        sameAs: ['https://github.com/Helvetly/helvetly'],
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Helvetly',
        url: `${SITE_URL}${localizedHref('/', lang)}`,
        description: translate('metaHomeDescription'),
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: lang,
        offers: PLANS.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          price: plan.monthly,
          priceCurrency: 'CHF',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: plan.monthly,
            priceCurrency: 'CHF',
            unitText: 'per person per month',
            valueAddedTaxIncluded: true,
          },
        })),
      },
    ],
  }
  return (
    <main>
      <script
        type="application/ld+json"
        // JSON.stringify output is safe in a script once "<" cannot close it.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replaceAll('<', '\\u003c'),
        }}
      />
      <Hero lang={lang} />
      <Standards lang={lang} />
      <About lang={lang} />
      <Features lang={lang} />
      <HeidiSection lang={lang} />
      <Steps lang={lang} />
      <Trust lang={lang} />
      <section id="pricing" className="py-12 sm:py-16">
        <Container>
          <SectionHeading
            className="lg:max-w-5xl [&>h2]:max-w-2xl"
            eyebrow={translate('pricing')}
            title={
              <>
                {translate('knowYourBill')}
                <span className="accent ink-gradient">{translate('beforeItArrives')}</span>
                {translate('pricingHeadingEnd')}
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
            <span className="accent ink-gradient">{translate('know')}</span>
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
