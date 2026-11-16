import { defaultLocale, locales, localizedHref } from '@helvetly/i18n'
import type { MetadataRoute } from 'next'

import { compareIn } from '@/lib/compare'
import { readCollection } from '@/lib/content'
import { topicsWithArticles } from '@/lib/help-topics'
import { LEGAL } from '@/lib/legal'

const SITE = 'https://www.helvetly.com'

// Generated once at build time: the site is a static export.
export const dynamic = 'force-static'

// Slugs are the English file names in every language.
const english = defaultLocale

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    '',
    '/pricing',
    '/compare',
    '/guides',
    ...readCollection('guides', english).map(({ slug }) => `/guides/${slug}`),
    '/help',
    ...topicsWithArticles(readCollection('help', english), english).map(
      ({ slug }) => `/help/topic/${slug}`,
    ),
    ...readCollection('help', english).map(({ slug }) => `/help/${slug}`),
    ...compareIn(english).COMPETITORS.map(({ slug }) => `/compare/${slug}`),
    '/security',
    ...Object.keys(LEGAL).map((s) => `/${s}`),
  ].flatMap((path) =>
    Object.keys(locales).map((language) => ({
      url: SITE + localizedHref(path || '/', language),
      alternates: {
        languages: Object.fromEntries(
          Object.entries(locales).map(([code, details]) => [
            details.languageTag,
            SITE + localizedHref(path || '/', code),
          ]),
        ),
      },
    })),
  )
}
