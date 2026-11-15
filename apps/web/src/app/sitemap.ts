import type { MetadataRoute } from 'next'

import { COMPETITORS } from '@/lib/compare'
import { readCollection } from '@/lib/content'
import { topicsWithArticles } from '@/lib/help-topics'
import { LEGAL } from '@/lib/legal'

const SITE = 'https://www.helvetly.com'

// Generated once at build time: the site is a static export.
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    '',
    '/pricing',
    '/compare',
    '/guides',
    ...readCollection('guides').map(({ slug }) => `/guides/${slug}`),
    '/help',
    ...topicsWithArticles(readCollection('help')).map(({ slug }) => `/help/topic/${slug}`),
    ...readCollection('help').map(({ slug }) => `/help/${slug}`),
    ...COMPETITORS.map(({ slug }) => `/compare/${slug}`),
    '/security',
    ...Object.keys(LEGAL).map((s) => `/${s}`),
  ].map((path) => ({
    url: SITE + path,
  }))
}
