import { defaultLocale } from '@helvetly/i18n'

import { compareIn } from '@/lib/compare'
import { readCollection } from '@/lib/content'
import { topicsWithArticles } from '@/lib/help-topics'
import { LEGAL } from '@/lib/legal'

export function publicPaths() {
  return [
    '/',
    '/pricing',
    '/compare',
    '/guides',
    ...readCollection('guides', defaultLocale).map(({ slug }) => `/guides/${slug}`),
    '/help',
    ...topicsWithArticles(readCollection('help', defaultLocale), defaultLocale).map(
      ({ slug }) => `/help/topic/${slug}`,
    ),
    ...readCollection('help', defaultLocale).map(({ slug }) => `/help/${slug}`),
    ...compareIn(defaultLocale).COMPETITORS.map(({ slug }) => `/compare/${slug}`),
    '/security',
    '/faq',
    ...Object.keys(LEGAL).map((s) => `/${s}`),
  ]
}
