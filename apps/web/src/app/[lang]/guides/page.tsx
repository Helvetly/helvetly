import { localizedHref } from '@helvetly/i18n'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { categoryLabel } from '@/lib/categories'
import { cn } from '@/lib/cn'
import { readCollection } from '@/lib/content'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'
import { type Tone, TONES } from '@/lib/tones'

type Props = { params: Promise<{ lang?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  return pageMetadata(
    lang,
    '/guides',
    translate('metaGuidesTitle'),
    translate('metaGuidesDescription'),
  )
}

const TONE: Record<string, Tone> = {
  VAT: 'mint',
  'Getting paid': 'peach',
  Invoicing: 'sky',
  'E-invoicing': 'lilac',
}

export default async function GuidesPage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const guides = readCollection('guides', lang)
  return (
    <main>
      <PageHero
        eyebrow={translate('guides')}
        title={
          <>
            {translate('swissPaperwork')}
            <span className="accent">{translate('explained')}</span>
          </>
        }
        lead={translate('vatTheQRBillRemindersAndEInvoicesIn')}
      />
      <section className="pb-16">
        <Container className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((g, i) => {
            const tone = TONES[TONE[g.category] ?? 'sky']
            return (
              <Link
                key={g.slug}
                href={localizedHref(`/guides/${g.slug}`, lang)}
                data-reveal
                style={{ ['--d' as string]: `${i * 70}ms` }}
                className={cn(
                  'group flex flex-col rounded-3xl border p-7 transition-colors hover:border-foreground/20',
                  tone.tile,
                  tone.border,
                )}
              >
                <span
                  className={cn(
                    'w-fit rounded-full px-3 py-1 text-caption font-medium',
                    tone.surface,
                    tone.ink,
                  )}
                >
                  {categoryLabel(g.category, lang)}
                </span>
                <h2 className="mt-4 text-title font-semibold text-balance">{g.title}</h2>
                <p className="mt-2 flex-1 text-body text-muted-foreground">{g.description}</p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium underline-offset-4 group-hover:underline">
                  {g.readingMinutes
                    ? translate('minRead', { readingMinutes: g.readingMinutes })
                    : translate('readTheGuide')}
                  <ArrowRight aria-hidden className="size-4" />
                </span>
              </Link>
            )
          })}
        </Container>
      </section>
    </main>
  )
}
