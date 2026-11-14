import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Container } from '@/components/section'
import { isLegalSlug, LEGAL, legalHref, readLegal, slugify } from '@/lib/legal'

type Props = { params: Promise<{ legal: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(LEGAL).map((legal) => ({ legal }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { legal } = await params
  return isLegalSlug(legal) ? { title: LEGAL[legal].title } : {}
}

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children)
  return ''
}

// Section headings get ids for the contents list; links between the files go to their pages.
const MARKDOWN: Components = {
  h2: ({ children }) => <h2 id={slugify(text(children))}>{children}</h2>,
  a: ({ href = '', children }) => <a href={legalHref(href)}>{children}</a>,
  // A wide table scrolls sideways in its own labelled box, which the keyboard can reach and scroll.
  table: ({ children }) => (
    <section aria-label="Table" tabIndex={0} className="legal-table">
      <table>{children}</table>
    </section>
  ),
}

export default async function LegalPage({ params }: Props) {
  const slug = (await params).legal
  if (!isLegalSlug(slug)) notFound()
  const { markdown, headings } = readLegal(slug)

  return (
    <main className="pt-32 pb-24 sm:pt-40">
      <Container className="grid gap-12 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav aria-label="Legal" className="sticky top-28 flex flex-col gap-1 text-body-sm">
            {Object.keys(LEGAL)
              .filter(isLegalSlug)
              .map((key) => (
                <Link
                  key={key}
                  href={`/${key}`}
                  aria-current={key === slug ? 'page' : undefined}
                  className="hover:bg-site-tint aria-[current=page]:bg-site-tint rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                >
                  {LEGAL[key].title}
                </Link>
              ))}
            {headings.length > 0 && (
              <>
                <p className="mt-6 px-3 text-caption font-medium text-muted-foreground uppercase">
                  On this page
                </p>
                {headings.map((h) => (
                  <a
                    key={h.id}
                    href={`#${h.id}`}
                    className="px-3 py-1 leading-snug text-muted-foreground hover:text-foreground"
                  >
                    {h.text}
                  </a>
                ))}
              </>
            )}
          </nav>
        </aside>
        <article className="min-w-0">
          <h1 className="text-subhero font-semibold">{LEGAL[slug].title}</h1>
          <div className="prose-legal mt-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
              {markdown}
            </ReactMarkdown>
          </div>
        </article>
      </Container>
    </main>
  )
}
