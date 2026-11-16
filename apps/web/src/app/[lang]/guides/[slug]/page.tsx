import { defaultLocale, localizedAlternates, localizedHref } from '@helvetly/i18n'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ArticleView } from '@/components/article'
import { categoryLabel } from '@/lib/categories'
import { readArticle, readCollection } from '@/lib/content'
import { languageOf, translatorFor } from '@/lib/i18n'

type Props = { params: Promise<{ lang?: string; slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return readCollection('guides', defaultLocale).map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lang = await languageOf(params)
  const guide = readArticle('guides', (await params).slug, lang)
  return guide
    ? {
        alternates: localizedAlternates(`/guides/${(await params).slug}`, lang),
        title: guide.title,
        description: guide.description,
      }
    : {}
}

export default async function GuidePage({ params }: Props) {
  const lang = await languageOf(params)
  const translate = translatorFor(lang)
  const guide = readArticle('guides', (await params).slug, lang)
  if (!guide) notFound()
  const others = readCollection('guides', lang).filter((g) => g.slug !== guide.slug)
  return (
    <ArticleView
      lang={lang}
      article={guide}
      kicker={
        <>
          <Link
            href={localizedHref('/guides', lang)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {translate('guides')}
          </Link>{' '}
          · {categoryLabel(guide.category, lang)}
        </>
      }
      aside={
        <>
          <p className="px-3 text-caption font-medium text-muted-foreground uppercase">
            {translate('moreGuides')}
          </p>
          {others.map((g) => (
            <Link
              key={g.slug}
              href={localizedHref(`/guides/${g.slug}`, lang)}
              className="hover:bg-site-tint rounded-lg px-3 py-1.5 leading-snug text-muted-foreground transition-colors hover:text-foreground"
            >
              {g.title}
            </Link>
          ))}
        </>
      }
    />
  )
}
