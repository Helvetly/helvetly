import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { cn } from '@/lib/cn'
import { readCollection } from '@/lib/content'
import { type Tone, TONES } from '@/lib/tones'

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'Plain-English guides to Swiss VAT, the QR bill, payment reminders and e-invoicing, for founders, freelancers and small teams.',
}

const TONE: Record<string, Tone> = {
  VAT: 'mint',
  'Getting paid': 'peach',
  Invoicing: 'sky',
  'E-invoicing': 'lilac',
}

export default function GuidesPage() {
  const guides = readCollection('guides')
  return (
    <main>
      <PageHero
        eyebrow="Guides"
        title={
          <>
            Swiss paperwork, <span className="accent">explained</span>
          </>
        }
        lead="VAT, the QR bill, reminders and e-invoices in plain English, with the official sources at the end of every guide."
      />
      <section className="pb-16">
        <Container className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((g, i) => {
            const tone = TONES[TONE[g.category] ?? 'sky']
            return (
              <Link
                key={g.slug}
                href={`/guides/${g.slug}`}
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
                  {g.category}
                </span>
                <h2 className="mt-4 text-title font-semibold text-balance">{g.title}</h2>
                <p className="mt-2 flex-1 text-body text-muted-foreground">{g.description}</p>
                <span className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium underline-offset-4 group-hover:underline">
                  {g.readingMinutes ? `${g.readingMinutes} min read` : 'Read the guide'}
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
