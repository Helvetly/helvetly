import { HeidiOrb } from '@helvetly/ui/components/heidi-mark'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Container, SectionHeading } from '@/components/section'

export type Question = { q: string; a: ReactNode }

/** Questions that open in place: native <details>, so keyboard, find-in-page and readers just work. */
export function Faq({ items }: { items: Question[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map(({ q, a }, i) => (
        <details
          key={q}
          name="faq"
          className="group faq border-site-line open:border-lilac-solid/30 rounded-2xl border bg-card/60 backdrop-blur transition-colors open:bg-card hover:border-foreground/15"
        >
          <summary className="flex cursor-pointer list-none items-center gap-4 rounded-2xl px-5 py-4 text-left text-title-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden
              className="group-open:text-lilac-ink w-6 shrink-0 font-mono text-body-sm text-muted-foreground tabular-nums transition-colors"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex-1">{q}</span>
            <span className="bg-site-tint group-open:bg-lilac-solid inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[rotate,background-color,color] duration-300 group-open:rotate-45 group-open:text-white">
              <Plus aria-hidden className="size-4" />
            </span>
          </summary>
          <div className="max-w-2xl pr-14 pb-5 pl-15 text-body text-muted-foreground sm:pl-16 [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4">
            {a}
          </div>
        </details>
      ))}
    </div>
  )
}

/**
 * A questions section: the heading and a dark help card held beside the list on wide screens, over a
 * soft pastel wash.
 */
export function FaqSection({
  id,
  eyebrow,
  title,
  lead,
  card,
  items,
}: {
  id?: string
  eyebrow: string
  title: ReactNode
  lead: string
  card: { title: string; body: string; href: string; link: string }
  items: Question[]
}) {
  return (
    <section id={id} className="relative pt-12 pb-8 sm:pt-16">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(60%_50%_at_15%_30%,var(--color-lilac),transparent),radial-gradient(50%_45%_at_90%_80%,var(--color-mint),transparent)] opacity-60"
      />
      <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
          <SectionHeading align="left" eyebrow={eyebrow} tone="lilac" title={title} lead={lead} />
          <div
            data-reveal
            className="night dark relative overflow-hidden rounded-3xl p-6 text-white"
          >
            <div aria-hidden className="beams beam absolute -top-1/2 -right-1/3 size-[30rem]" />
            <div className="relative flex items-start gap-4">
              <HeidiOrb className="size-11 shrink-0" />
              <div>
                <p className="text-title-sm font-semibold">{card.title}</p>
                <p className="mt-1 text-body-sm text-white/70">{card.body}</p>
                <Link
                  href={card.href}
                  className="mt-3 inline-block text-body-sm font-medium text-white underline underline-offset-4 hover:text-heidi-ink"
                >
                  {card.link}
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div data-reveal>
          <Faq items={items} />
        </div>
      </Container>
    </section>
  )
}
