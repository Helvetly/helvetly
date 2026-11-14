import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ArticleView } from '@/components/article'
import { readArticle, readCollection } from '@/lib/content'
import { topicSlug } from '@/lib/help-topics'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return readCollection('help').map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = readArticle('help', (await params).slug)
  return article ? { title: article.title, description: article.description } : {}
}

export default async function HelpArticlePage({ params }: Props) {
  const article = readArticle('help', (await params).slug)
  if (!article) notFound()
  const siblings = readCollection('help').filter((a) => a.category === article.category)
  return (
    <ArticleView
      article={article}
      kicker={
        <>
          <Link href="/help" className="underline underline-offset-4 hover:text-foreground">
            Help center
          </Link>{' '}
          ·{' '}
          <Link
            href={`/help/topic/${topicSlug(article.category)}`}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {article.category}
          </Link>
        </>
      }
      aside={
        <>
          <p className="px-3 text-caption font-medium text-muted-foreground uppercase">
            {article.category}
          </p>
          {siblings.map((a) => (
            <Link
              key={a.slug}
              href={`/help/${a.slug}`}
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
