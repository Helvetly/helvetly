import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ArticleView } from '@/components/article'
import { readArticle, readCollection } from '@/lib/content'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return readCollection('guides').map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = readArticle('guides', (await params).slug)
  return guide ? { title: guide.title, description: guide.description } : {}
}

export default async function GuidePage({ params }: Props) {
  const guide = readArticle('guides', (await params).slug)
  if (!guide) notFound()
  const others = readCollection('guides').filter((g) => g.slug !== guide.slug)
  return (
    <ArticleView
      article={guide}
      kicker={
        <>
          <Link href="/guides" className="underline underline-offset-4 hover:text-foreground">
            Guides
          </Link>{' '}
          · {guide.category}
        </>
      }
      aside={
        <>
          <p className="px-3 text-caption font-medium text-muted-foreground uppercase">
            More guides
          </p>
          {others.map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
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
