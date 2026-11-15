import { localizedHref } from '@helvetly/i18n'
import { isValidElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Cta } from '@/components/cta'
import { Container } from '@/components/section'
import type { Article } from '@/lib/content'
import { formatDay } from '@/lib/content'
import { translate } from '@/lib/i18n'
import { slugify } from '@/lib/legal'
import { START_URL } from '@/lib/site'

function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children)
  return ''
}

// Section headings get ids for "On this page"; links to other sites open in place, marked as external.
const MARKDOWN: Components = {
  h2: ({ children }) => <h2 id={slugify(text(children))}>{children}</h2>,
  a: ({ href = '', children }) =>
    href.startsWith('http') ? (
      <a href={localizedHref(href)} rel="noopener">
        {children}
      </a>
    ) : (
      <a href={localizedHref(href)}>{children}</a>
    ),
}

/** A guide or help article: its section list beside the text, then a call to try Helvetly. */
export function ArticleView({
  article,
  kicker,
  aside,
}: {
  article: Article
  kicker: ReactNode
  aside?: ReactNode
}) {
  return (
    <main className="pt-32 pb-24 sm:pt-40">
      <Container className="grid gap-12 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <nav
            aria-label={translate('onThisPage')}
            className="sticky top-28 flex flex-col gap-1 text-body-sm"
          >
            {aside}
            {article.headings.length > 0 && (
              <>
                <p className="mt-6 px-3 text-caption font-medium text-muted-foreground uppercase first:mt-0">
                  {translate('onThisPage')}
                </p>
                {article.headings.map((h) => (
                  <a
                    key={h.id}
                    href={localizedHref(`#${h.id}`)}
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
          <div className="text-body-sm text-muted-foreground">{kicker}</div>
          <h1 className="text-subhero mt-3 max-w-3xl font-semibold text-balance">
            {article.title}
          </h1>
          <p className="text-lead mt-4 max-w-2xl text-balance text-muted-foreground">
            {article.description}
          </p>
          <p className="mt-4 text-body-sm text-muted-foreground">
            {translate('updated')}
            {formatDay(article.updated)}
            {article.readingMinutes
              ? translate('minRead2', { readingMinutes: article.readingMinutes })
              : ''}
          </p>
          <div className="prose-legal mt-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
              {article.markdown}
            </ReactMarkdown>
          </div>
          <div className="night dark mt-14 flex max-w-3xl flex-col items-start gap-4 overflow-hidden rounded-3xl p-7 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-title-sm font-semibold">{translate('letHelvetlyDoTheBusywork')}</p>
              <p className="mt-1 text-body-sm text-white/70">
                {translate('qrInvoicesRemindersAndTheVATReturnInOne')}
              </p>
            </div>
            <Cta href={START_URL} className="shrink-0">
              {translate('startYourFreeTrial')}
            </Cta>
          </div>
        </article>
      </Container>
    </main>
  )
}
