import { Logo } from '@helvetly/ui/components/logo'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { cn } from '@/lib/cn'
import { COMPETITORS } from '@/lib/compare'
import { TONES } from '@/lib/tones'

export const metadata: Metadata = {
  title: 'Helvetly compared',
  description:
    'Honest, side-by-side comparisons of Helvetly with other Swiss business software: Magic Heidi, bexio, KLARA, Banana, CashCtrl and AbaNinja.',
}

export default function CompareIndexPage() {
  return (
    <main>
      <PageHero
        eyebrow="Comparisons"
        title={
          <>
            Choosing your <span className="accent">back office?</span>
          </>
        }
        lead="Side by side with the tools Swiss companies use, feature by feature, including where the others are the better fit."
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
                {c.name} alternative
              </span>
              <div aria-hidden className="mt-5 flex items-center gap-2">
                <Logo className="size-8 rounded-lg bg-white p-0.5 ring-1 ring-black/5" />
                <span className="text-body-sm text-muted-foreground">vs</span>
                <Image
                  src={c.logo}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 rounded-lg bg-white p-0.5 ring-1 ring-black/5"
                />
              </div>
              <h2 className="mt-3 text-title font-semibold">Helvetly vs {c.name}</h2>
              <p className="mt-2 flex-1 text-body text-muted-foreground">{c.summary}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium underline-offset-4 group-hover:underline">
                See the comparison
                <ArrowRight aria-hidden className="size-4" />
              </span>
            </Link>
          ))}
        </Container>
      </section>
    </main>
  )
}
