import { type Locale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import type { Metadata } from 'next'
import Link from 'next/link'
import { isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Container } from '@/components/section'
import { perLanguage, translatorFor } from '@/lib/i18n'
import {
  isLegalSlug,
  LEGAL,
  type LegalSlug,
  legalHref,
  legalTitlesIn,
  readLegal,
  slugify,
} from '@/lib/legal'
import { pageMetadata } from '@/lib/metadata'

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children)
  return ''
}

export function legalMetadata(slug: LegalSlug, lang: Locale): Metadata {
  const title = legalTitlesIn(lang)[slug]
  return pageMetadata(
    lang,
    `/${slug}`,
    title,
    translatorFor(lang)('metaLegalDescription', { title }),
  )
}

// Section headings get ids for the contents list; links between the files go to their pages.
const markdownIn = perLanguage((translate, language): Components => ({
  h2: ({ children }) => <h2 id={slugify(text(children))}>{children}</h2>,
  a: ({ href = '', children }) => <a href={publicHref(legalHref(href), language)}>{children}</a>,
  // A wide table scrolls sideways in its own labelled box, which the keyboard can reach and scroll.
  table: ({ children }) => (
    <section aria-label={translate('table')} tabIndex={0} className="legal-table">
      <table>{children}</table>
    </section>
  ),
}))

/** A legal text from apps/web/content/legal, with the other texts and its sections beside it. */
export function LegalView({ lang, slug }: { lang: Locale; slug: LegalSlug }) {
  const translate = translatorFor(lang)
  const { markdown, headings } = readLegal(slug, lang)

  return (
    <main className="pt-32 pb-24 sm:pt-40">
      <Container className="grid gap-12 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <nav
            aria-label={translate('legal')}
            className="sticky top-28 flex flex-col gap-1 text-body-sm"
          >
            {Object.keys(LEGAL)
              .filter(isLegalSlug)
              .map((key) => (
                <Link
                  key={key}
                  href={publicHref(`/${key}`, lang)}
                  aria-current={key === slug ? 'page' : undefined}
                  className="hover:bg-site-tint aria-[current=page]:bg-site-tint rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                >
                  {legalTitlesIn(lang)[key]}
                </Link>
              ))}
            {headings.length > 0 && (
              <>
                <p className="mt-6 px-3 text-caption font-medium text-muted-foreground uppercase">
                  {translate('onThisPage')}
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
          <h1 className="text-subhero font-semibold wrap-anywhere">{legalTitlesIn(lang)[slug]}</h1>
          <div className="prose-legal mt-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownIn(lang)}>
              {markdown}
            </ReactMarkdown>
          </div>
        </article>
      </Container>
    </main>
  )
}
