import { type Locale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import { HeidiOrb } from '@helvetly/ui/components/heidi-mark'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Container, SectionHeading } from '@/components/section'
import { SiteLink } from '@/components/site-link'
import { faqIn, type Question } from '@/lib/faq'
import { translatorFor } from '@/lib/i18n'

/** The questions a page leads with, then one link to the FAQ page that answers them all. */
export function FaqTeaser({ lang, teaser }: { lang: Locale; teaser: 'home' | 'pricing' }) {
  const translate = translatorFor(lang)
  const all = faqIn(lang)
  const items = all.filter((item) => item.teaser === teaser)
  return (
    <FaqList>
      {items.map((item, i) => (
        <FaqItem key={item.id} item={item} index={i} />
      ))}
      <Link
        href={publicHref('/faq', lang)}
        className="block px-5 py-3.5 text-body-sm font-medium text-link underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-6"
      >
        {translate('seeAllQuestions', { count: all.length })}
      </Link>
    </FaqList>
  )
}

/** The bordered box the questions sit in. */
export function FaqList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-site-line border-site-line divide-y overflow-hidden rounded-2xl border bg-card/60 backdrop-blur">
      {children}
    </div>
  )
}

/** One question that opens in place: native <details>, so keyboard, find-in-page and readers just work. */
export function FaqItem({
  item: { q, a },
  index,
  id,
}: {
  item: Question
  index: number
  id?: string
}) {
  return (
    <details
      id={id}
      name="faq"
      className="group faq scroll-mt-28 transition-colors open:bg-card hover:bg-card/80"
    >
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3.5 text-left text-body font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-6 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="group-open:text-lilac-ink w-6 shrink-0 font-mono text-body-sm text-muted-foreground tabular-nums transition-colors"
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="flex-1">{q}</span>
        <span className="bg-site-tint group-open:bg-lilac-solid inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[rotate,background-color,color] duration-300 group-open:rotate-45 group-open:text-white">
          <Plus aria-hidden className="size-4" />
        </span>
      </summary>
      <div className="max-w-2xl pr-14 pb-5 pl-15 text-body text-muted-foreground sm:pl-16 [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4">
        {a}
      </div>
    </details>
  )
}

/**
 * A questions section: the heading and a dark help card held beside the list on wide screens, over a
 * soft pastel wash.
 */
export function FaqSection({
  lang,
  id,
  eyebrow,
  title,
  lead,
  card,
  teaser,
}: {
  lang: Locale
  id?: string
  eyebrow: string
  title: ReactNode
  lead: string
  card: { title: string; body: string; href: string; link: string }
  teaser: 'home' | 'pricing'
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
                <SiteLink
                  href={card.href}
                  className="mt-3 inline-block text-body-sm font-medium text-white underline underline-offset-4 hover:text-heidi-ink"
                >
                  {card.link}
                </SiteLink>
              </div>
            </div>
          </div>
        </div>
        <div data-reveal>
          <FaqTeaser lang={lang} teaser={teaser} />
        </div>
      </Container>
    </section>
  )
}
