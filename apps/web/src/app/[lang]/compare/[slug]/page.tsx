import { defaultLocale, localizedHref } from '@helvetly/i18n'
import { Logo } from '@helvetly/ui/components/logo'
import { YEARLY_DISCOUNT_PERCENT } from '@helvetly/ui/lib/price'
import { Check, Minus } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'

import { CompareTable, PriceBlock } from '@/components/comparison'
import { Cta } from '@/components/cta'
import { OfferProvider } from '@/components/offer-provider'
import { PageHero } from '@/components/page-hero'
import { Container, SectionHeading } from '@/components/section'
import { compareIn } from '@/lib/compare'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'
import { siteIn } from '@/lib/site'
import { PRO_TRIAL_DAYS } from '@/lib/team-pricing'

type Props = { params: Promise<{ lang?: string; slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return compareIn(defaultLocale).COMPETITORS.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const { slug } = await params
  const them = compareIn(lang).competitor(slug)
  return them
    ? pageMetadata(
        lang,
        `/compare/${slug}`,
        { absolute: translate('helvetlyVs', { name: them.name }) },
        translate('metaCompareVsDescription', { name: them.name }),
      )
    : {}
}

export default async function ComparePage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const them = compareIn(lang).competitor((await params).slug)
  if (!them) notFound()
  const site = new URL(them.url).hostname.replace(/^www\./, '')
  return (
    <main>
      <PageHero
        eyebrow={
          <>
            <Logo className="size-5 rounded-md bg-white p-px ring-1 ring-black/5" />
            {translate('helvetly')}
            <span className="text-muted-foreground">{translate('vs')}</span>
            <Image
              src={them.logo}
              alt=""
              width={20}
              height={20}
              className="size-5 rounded-md bg-white p-px ring-1 ring-black/5"
            />
            {them.name}
          </>
        }
        title={them.title}
        lead={them.lead}
      >
        <div data-reveal style={{ ['--d' as string]: '150ms' }} className="mx-auto mt-8 max-w-xl">
          <h2 className="text-body-sm font-medium text-muted-foreground">
            {translate('helvetlyIsTheBetterFitWhenYou')}
          </h2>
          <ul className="mt-3 grid gap-2 text-left text-body">
            {them.oursIf.map((item) => (
              <li key={item} className="flex gap-2.5">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-brand" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div
          data-reveal
          style={{ ['--d' as string]: '200ms' }}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <Cta href={siteIn(lang).START_URL}>
            {translate('tryProFreeForDays', { days: PRO_TRIAL_DAYS })}
          </Cta>
          <Cta href={localizedHref('/pricing', lang)} variant="outline">
            {translate('seePricing')}
          </Cta>
        </div>
      </PageHero>

      <OfferProvider>
        <section className="py-12">
          <Container>
            <SectionHeading
              eyebrow={translate('cmpGroupPrice')}
              title={translate('cmpYearByTeamSize')}
            />
            <div className="mx-auto mt-8 max-w-3xl">
              <PriceBlock lang={lang} them={them} />
              <p className="mt-3 text-center text-body-sm text-muted-foreground">
                {translate('cmpPriceBlockNote', {
                  name: them.name,
                  date: them.pricesChecked,
                  percent: YEARLY_DISCOUNT_PERCENT,
                })}
              </p>
            </div>
          </Container>
        </section>

        <section className="py-12">
          <Container>
            <SectionHeading
              eyebrow={translate('sideBySide')}
              title={translate('featureByFeature')}
            />
            <div className="mt-10">
              <CompareTable lang={lang} them={them} />
            </div>
            <p className="mx-auto mt-4 max-w-3xl text-center text-body-sm text-muted-foreground">
              {translate('cmpLegend', { name: them.name })}
            </p>
          </Container>
        </section>
      </OfferProvider>

      <section className="pb-16">
        <Container className="max-w-3xl">
          <div data-reveal className="border-site-line rounded-3xl border p-6">
            <h2 className="text-title-sm font-semibold">
              {them.name}
              {translate('maySuitYouBetterIfYou')}
            </h2>
            <ul className="mt-3 grid gap-2 text-body text-muted-foreground">
              {them.theirsIf.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Minus aria-hidden className="mt-1 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-6 text-center text-body-sm text-muted-foreground">
            {translate('what')}
            {them.name}
            {translate('offersComesFromItsPublicWebsite')}{' '}
            <a
              href={them.url}
              rel="noopener"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {site}
            </a>
            {translate('asOf')}
            {them.checked}
            {translate('andItsPricesAndPackagesAsOf')}
            {them.pricesChecked}
            {translate('aDashMeansItIsNotOfferedOrWe2')}
            {them.name}
            {translate('andItsLogoAreTrademarksOfTheirOwnerWhich')}
          </p>
        </Container>
      </section>
    </main>
  )
}
