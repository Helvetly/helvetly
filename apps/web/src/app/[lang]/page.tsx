import { localeDetails, locales, localizedHref } from '@helvetly/i18n'

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
        '@id': `${SITE_URL}/#organization`,
        name: 'Helvetly',
        url: SITE_URL,
        logo: `${SITE_URL}/apple-icon.png`,
        sameAs: ['https://github.com/Helvetly/helvetly'],
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'Helvetly',
        url: SITE_URL,
        inLanguage: Object.values(locales).map(({ languageTag }) => languageTag),
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}${localizedHref('/', lang)}#software`,
        name: 'Helvetly',
        url: `${SITE_URL}${localizedHref('/', lang)}`,
        description: translate('whatIsHelvetlyAnswer'),
        featureList: [
          translate('clients'),
          translate('featureGroupInvoicing'),
          translate('expenses'),
          translate('documents'),
          translate('electronicSignatures'),
          translate('clientPortal'),
          translate('featureGroupBooks'),
          translate('employeesAndPayrollRegister'),
          translate('heidi'),
        ],
        publisher: { '@id': `${SITE_URL}/#organization` },
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: localeDetails(lang).languageTag,
        offers: PLANS.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          price: plan.monthly,
          priceCurrency: 'CHF',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: plan.monthly,
            priceCurrency: 'CHF',
            // The base price covers the plan's included people; each further person costs extra.
            unitText:
              plan.includedPeople === 1
                ? 'per month, 1 person included'
                : `per month, ${plan.includedPeople} people included`,
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
            lead={translate('startFreeThenGrowPricingLead', {
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
