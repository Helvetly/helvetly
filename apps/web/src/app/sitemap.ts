import { defaultLocale } from '@helvetly/i18n'
import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/metadata'
import { publicAlternates, publicPaths } from '@/lib/public-paths'

// Generated once at build time: the site is a static export.
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths().flatMap((path) => {
    const languages = Object.fromEntries(
      Object.entries(publicAlternates(path, defaultLocale).languages).map(([tag, href]) => [
        tag,
        SITE_URL + href,
      ]),
    )
    return [...new Set(Object.values(languages))].map((url) => ({ url, alternates: { languages } }))
  })
}
