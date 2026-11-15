import { localizedAlternates } from '@helvetly/i18n'
import { Logo } from '@helvetly/ui/components/logo'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { cn } from '@/lib/cn'
import { COMPETITORS } from '@/lib/compare'
import { translate } from '@/lib/i18n'
import { TONES } from '@/lib/tones'

export const metadata: Metadata = {
  alternates: localizedAlternates('/compare'),

  title: translate('helvetlyCompared'),
  description: translate('honestSideBySideComparisonsOfHelvetlyWithOther'),
}

export default function CompareIndexPage() {
  return (
    <main>
      <PageHero
        eyebrow={translate('comparisons')}
        title={
          <>
            {translate('choosingYour')}
            <span className="accent">{translate('backOffice')}</span>
          </>
        }
        lead={translate('sideBySideWithTheToolsSwissCompaniesUse')}
      />
      <section className="pb-16">
        <Container className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {COMPETITORS.map((c, i) => (
            <Link
              key={c.slug}
              href={`/compare/${c.slug}`}
              data-reveal
              style={{ ['--d' as string]: `${i * 80}ms` }}
              className={cn(
                'group relative flex flex-col overflow-hidden rounded-3xl border p-7 transition-colors',
                TONES[c.tone].tile,
                TONES[c.tone].border,
                'hover:border-foreground/20',
              )}
            >
              <span
                className={cn(
                  'w-fit rounded-full px-3 py-1 text-caption font-medium',
                  TONES[c.tone].surface,
                  TONES[c.tone].ink,
                )}
              >
                {c.name}
                {translate('alternative')}
              </span>
              <div aria-hidden className="mt-5 flex items-center gap-2">
                <Logo className="size-8 rounded-lg bg-white p-0.5 ring-1 ring-black/5" />
                <span className="text-body-sm text-muted-foreground">{translate('vs')}</span>
                <Image
                  src={c.logo}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 rounded-lg bg-white p-0.5 ring-1 ring-black/5"
                />
              </div>
              <h2 className="mt-3 text-title font-semibold">
                {translate('helvetlyVs2')}
                {c.name}
              </h2>
              <p className="mt-2 flex-1 text-body text-muted-foreground">{c.summary}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium underline-offset-4 group-hover:underline">
                {translate('seeTheComparison')}
                <ArrowRight aria-hidden className="size-4" />
              </span>
            </Link>
          ))}
        </Container>
      </section>
    </main>
  )
}
