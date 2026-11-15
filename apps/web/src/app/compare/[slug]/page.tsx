import { localizedHref, localizedAlternates } from '@helvetly/i18n'
import { Logo } from '@helvetly/ui/components/logo'
import { Check, Minus } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'

import { Cta } from '@/components/cta'
import { PageHero } from '@/components/page-hero'
import { Container, SectionHeading } from '@/components/section'
import { type Cell, competitor, COMPETITORS, OURS, ROW_GROUPS } from '@/lib/compare'
import { translate } from '@/lib/i18n'
import { TRIAL } from '@/lib/plans'
import { START_URL } from '@/lib/site'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return COMPETITORS.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const them = competitor((await params).slug)
  return them
    ? {
        alternates: localizedAlternates(`/compare/${(await params).slug}`),

        title: translate('helvetlyVs', { name: them.name }),
        description: translate('anHonestComparisonOfHelvetlyAndForSwissCompanies', {
          name: them.name,
        }),
      }
    : {}
}

function Value({ cell }: { cell: Cell }) {
  if (cell === null)
    return (
      <>
        <Minus aria-hidden className="size-4 text-placeholder" />
        <span className="sr-only">{translate('notFoundOnTheirWebsite')}</span>
      </>
    )
  if (cell === true)
    return (
      <>
        <Check aria-hidden className="size-4 text-brand" />
        <span className="sr-only">{translate('yes')}</span>
      </>
    )
  if (cell === false)
    return (
      <>
        <Minus aria-hidden className="size-4 text-placeholder" />
        <span className="sr-only">{translate('notOffered')}</span>
      </>
    )
  return <span className="text-body">{cell}</span>
}

export default async function ComparePage({ params }: Props) {
  const them = competitor((await params).slug)
  if (!them) notFound()
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
        <div
          data-reveal
          style={{ ['--d' as string]: '200ms' }}
          className="mt-9 flex flex-col gap-3 sm:flex-row"
        >
          <Cta href={START_URL}>
            {translate('tryBusinessFreeFor')}
            {TRIAL.days}
            {translate('days')}
          </Cta>
          <Cta href="/pricing" variant="outline">
            {translate('seePricing')}
          </Cta>
        </div>
      </PageHero>

      <section className="py-16">
        <Container className="grid gap-4 md:grid-cols-2">
          <div data-reveal className="border-site-line bg-site-tint rounded-3xl border p-7">
            <h2 className="text-title font-semibold">
              {translate('helvetlyIsTheBetterFitWhenYou')}
            </h2>
            <ul className="mt-4 grid gap-2.5 text-body">
              {them.oursIf.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div
            data-reveal
            style={{ ['--d' as string]: '100ms' }}
            className="border-site-line rounded-3xl border p-7"
          >
            <h2 className="text-title font-semibold">
              {them.name}
              {translate('maySuitYouBetterIfYou')}
            </h2>
            <ul className="mt-4 grid gap-2.5 text-body text-muted-foreground">
              {them.theirsIf.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <Minus aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <SectionHeading eyebrow={translate('sideBySide')} title={translate('featureByFeature')} />
          <div
            data-reveal
            className="border-site-line relative mt-12 overflow-x-auto rounded-3xl border"
          >
            <table className="w-full min-w-[680px] border-collapse text-left">
              <caption className="sr-only">
                {translate('helvetlyComparedWith')}
                {them.name}
              </caption>
              <thead className="bg-site-tint">
                <tr>
                  <th
                    scope="col"
                    className="w-2/5 p-5 text-body-sm font-medium text-muted-foreground"
                  >
                    &nbsp;
                  </th>
                  <th scope="col" className="bg-mint/50 w-[30%] p-5 text-title-sm font-semibold">
                    <span className="flex items-center gap-2.5">
                      <Logo className="size-6 rounded-md bg-white p-0.5 ring-1 ring-black/5" />
                      {translate('helvetly')}
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="w-[30%] p-5 text-title-sm font-semibold text-muted-foreground"
                  >
                    <span className="flex items-center gap-2.5">
                      <Image
                        src={them.logo}
                        alt=""
                        width={24}
                        height={24}
                        className="size-6 rounded-md bg-white p-0.5 ring-1 ring-black/5"
                      />
                      {them.name}
                    </span>
                  </th>
                </tr>
              </thead>
              {ROW_GROUPS.map(({ group, rows }) => (
                <tbody key={group}>
                  <tr key={group} className="border-site-line bg-site-tint border-t">
                    <th
                      scope="rowgroup"
                      colSpan={3}
                      className="p-5 py-3 text-body-sm font-medium text-muted-foreground"
                    >
                      {group}
                    </th>
                  </tr>
                  {rows.map(({ key, label }) => (
                    <tr key={key} className="border-site-line border-t align-top">
                      <th scope="row" className="p-5 py-4 text-body font-normal">
                        {label}
                      </th>
                      {/* Helvetly's column is tinted, so it reads as one band down the table. */}
                      <td className="bg-mint/25 p-5 py-4 font-medium">
                        <Value cell={OURS[key]} />
                      </td>
                      <td className="p-5 py-4 text-muted-foreground">
                        <Value cell={them.rows[key]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="mx-auto mt-6 max-w-3xl text-center text-body-sm text-muted-foreground">
            {translate('what')}
            {them.name}
            {translate('offersComesFromItsPublicWebsite')}{' '}
            <a
              href={localizedHref(them.url)}
              rel="noopener"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {new URL(them.url).hostname.replace(/^www\./, '')}
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
