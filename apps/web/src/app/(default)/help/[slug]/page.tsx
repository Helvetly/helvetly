import { defaultLocale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ArticleView } from '@/components/article'
import { categoryLabel } from '@/lib/categories'
import { readArticle, readCollection } from '@/lib/content'
import { topicSlug } from '@/lib/help-topics'
import { languageOf, translatorFor } from '@/lib/i18n'
import { pageMetadata } from '@/lib/metadata'

type Props = { params: Promise<{ lang?: string; slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return readCollection('help', defaultLocale).map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const article = readArticle('help', (await params).slug, lang)
  return article
    ? pageMetadata(lang, `/help/${(await params).slug}`, article.title, article.description)
    : {}
}

export default async function HelpArticlePage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const article = readArticle('help', (await params).slug, lang)
  if (!article) notFound()
  const siblings = readCollection('help', lang).filter((a) => a.category === article.category)
  return (
    <ArticleView
      lang={lang}
      article={article}
      kicker={
        <>
          <Link
            href={publicHref('/help', lang)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {translate('helpCenter')}
          </Link>{' '}
          ·{' '}
          <Link
            href={publicHref(`/help/topic/${topicSlug(article.category)}`, lang)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {categoryLabel(article.category, lang)}
          </Link>
        </>
      }
      aside={
        <>
          <p className="px-3 text-caption font-medium text-muted-foreground uppercase">
            {categoryLabel(article.category, lang)}
          </p>
          {siblings.map((a) => (
            <Link
              key={a.slug}
              href={publicHref(`/help/${a.slug}`, lang)}
              aria-current={a.slug === article.slug ? 'page' : undefined}
              className="hover:bg-site-tint aria-[current=page]:bg-site-tint rounded-lg px-3 py-1.5 leading-snug text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {a.title}
            </Link>
          ))}
        </>
      }
    />
  )
}
