import { defaultLocale, type Locale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHero } from '@/components/page-hero'
import { Container } from '@/components/section'
import { categoryLabel } from '@/lib/categories'
import { cn } from '@/lib/cn'
import { readCollection } from '@/lib/content'
import { topicsWithArticles } from '@/lib/help-topics'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'
import { TONES } from '@/lib/tones'

type Props = { params: Promise<{ lang?: string; topic: string }> }

export const dynamicParams = false

const topics = (lang: Locale) => topicsWithArticles(readCollection('help', lang), lang)

export function generateStaticParams() {
  return topics(defaultLocale).map(({ slug }) => ({ topic: slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const slug = (await params).topic
  const topic = topics(lang).find((t) => t.slug === slug)
  return topic
    ? pageMetadata(
        lang,
        `/help/topic/${slug}`,
        translate('helpCenter2', { name: categoryLabel(topic.name, lang) }),
        topic.blurb,
      )
    : {}
}

export default async function HelpTopicPage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const all = topics(lang)
  const slug = (await params).topic
  const topic = all.find((t) => t.slug === slug)
  if (!topic) notFound()
  const Icon = topic.icon
  return (
    <main>
      <PageHero
        eyebrow={
          <Link href={publicHref('/help', lang)} className="underline-offset-4 hover:underline">
            {translate('helpCenter')}
          </Link>
        }
        title={categoryLabel(topic.name, lang)}
        lead={topic.blurb}
      />
      <section className="pb-24">
        <Container className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_260px]">
          <ol className="grid gap-3">
            {topic.articles.map((article, i) => (
              <li key={article.slug}>
                <Link
                  href={publicHref(`/help/${article.slug}`, lang)}
                  className="group border-site-line flex items-start gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/20"
                >
                  <span
                    className={cn(
                      'inline-flex size-9 shrink-0 items-center justify-center rounded-xl font-mono text-body-sm',
                      TONES[topic.tone].surface,
                      TONES[topic.tone].ink,
                    )}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-title-sm font-semibold underline-offset-4 group-hover:underline">
                      {article.title}
                    </span>
                    <span className="mt-1 block text-body text-muted-foreground">
                      {article.description}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ol>
          <aside>
            <div
              className={cn(
                'rounded-3xl border p-5',
                TONES[topic.tone].tile,
                TONES[topic.tone].border,
              )}
            >
              <span
                className={cn(
                  'inline-flex size-11 items-center justify-center rounded-2xl text-white',
                  TONES[topic.tone].solid,
                )}
              >
                <Icon aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-body-sm text-muted-foreground">
                {topic.articles.length} {topic.articles.length === 1 ? 'article' : 'articles'}
              </p>
            </div>
            <nav
              aria-label={translate('otherTopics')}
              className="mt-6 flex flex-col gap-1 text-body-sm"
            >
              <p className="px-3 text-caption font-medium text-muted-foreground uppercase">
                {translate('otherTopics')}
              </p>
              {all
                .filter((t) => t.slug !== topic.slug)
                .map((t) => (
                  <Link
                    key={t.slug}
                    href={publicHref(`/help/topic/${t.slug}`, lang)}
                    className="hover:bg-site-tint rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {categoryLabel(t.name, lang)}
                  </Link>
                ))}
            </nav>
          </aside>
        </Container>
      </section>
    </main>
  )
}
