import { defaultLocale, isLocale, locales, localizedAlternates } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'
import type { MetadataRoute } from 'next'

import { publicPaths } from '@/lib/public-paths'

const SITE = 'https://www.helvetly.com'

// Generated once at build time: the site is a static export.
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths().flatMap((path) =>
    Object.keys(locales)
      .filter(isLocale)
      .map((language) => ({
        url: SITE + publicHref(path, language),
        alternates: {
          languages: Object.fromEntries(
            Object.entries(localizedAlternates(path, defaultLocale, publicHref).languages).map(
              ([languageTag, href]) => [languageTag, SITE + href],
            ),
          ),
        },
      })),
  )
}
