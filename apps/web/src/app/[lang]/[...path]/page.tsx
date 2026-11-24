import { isLocale, type Locale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import * as compareArticle from '@/app/(default)/compare/[slug]/page'
import * as compare from '@/app/(default)/compare/page'
import * as dpa from '@/app/(default)/dpa/page'
import * as faq from '@/app/(default)/faq/page'
import * as guidesArticle from '@/app/(default)/guides/[slug]/page'
import * as guides from '@/app/(default)/guides/page'
import * as helpArticle from '@/app/(default)/help/[slug]/page'
import * as help from '@/app/(default)/help/page'
import * as helpTopic from '@/app/(default)/help/topic/[topic]/page'
import * as imprint from '@/app/(default)/imprint/page'
import * as pricing from '@/app/(default)/pricing/page'
import * as privacy from '@/app/(default)/privacy/page'
import * as security from '@/app/(default)/security/page'
import * as subprocessors from '@/app/(default)/subprocessors/page'
import * as terms from '@/app/(default)/terms/page'
import { publicPaths } from '@/lib/public-paths'

type Resolved = { params: Promise<{ lang: Locale; slug: string; topic: string }> }
const pages = new Map<
  string,
  {
    default: (props: Resolved) => Promise<React.ReactNode>
    generateMetadata: (props: Resolved) => Promise<Metadata>
  }
>([
  ['/compare/[slug]', compareArticle],
  ['/compare', compare],
  ['/dpa', dpa],
  ['/faq', faq],
  ['/guides/[slug]', guidesArticle],
  ['/guides', guides],
  ['/help/[slug]', helpArticle],
  ['/help', help],
  ['/help/topic/[topic]', helpTopic],
  ['/imprint', imprint],
  ['/pricing', pricing],
  ['/privacy', privacy],
  ['/security', security],
  ['/subprocessors', subprocessors],
  ['/terms', terms],
])

export const dynamicParams = false

type Props = { params: Promise<{ lang: Locale; path: string[] }> }

// The same content and metadata render at the English route and its translated pathname.
const paths = publicPaths().filter((path) => path !== '/')
const byLanguage = new Map<Locale, Map<string, string>>()
function routesFor(lang: Locale) {
  let routes = byLanguage.get(lang)
  if (!routes) {
    routes = new Map(paths.map((path) => [publicHref(path, lang), path]))
    byLanguage.set(lang, routes)
  }
  return routes
}

export function generateStaticParams({ params }: { params: { lang: string } }) {
  if (!isLocale(params.lang)) return []
  return [...routesFor(params.lang).keys()].map((url) => ({ path: url.split('/').slice(2) }))
}

async function resolvePage({ params }: Props) {
  const { lang, path } = await params
  const id = routesFor(lang).get(`/${lang}/${path.join('/')}`)
  if (!id) notFound()
  const segments = id.split('/')
  const slug = segments.pop() ?? ''
  const parent = segments.join('/')
  const page =
    pages.get(id) ?? pages.get(parent + (parent === '/help/topic' ? '/[topic]' : '/[slug]'))
  if (!page) notFound()
  return { page, props: { params: Promise.resolve({ lang, slug, topic: slug }) } }
}

export async function generateMetadata(props: Props) {
  const { page, props: resolved } = await resolvePage(props)
  return page.generateMetadata(resolved)
}

export default async function LocalizedPage(props: Props) {
  const { page, props: resolved } = await resolvePage(props)
  return page.default(resolved)
}
