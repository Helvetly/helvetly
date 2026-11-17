import {
  type Locale,
  localeDetails,
  locales,
  localizedAlternates,
  localizedHref,
} from '@helvetly/i18n'
import type { Metadata } from 'next'

export const SITE_URL = 'https://www.helvetly.com'
export const TITLE_TEMPLATE = '%s · Helvetly'
const IMAGE = { url: '/og.png', width: 1200, height: 630, alt: 'Helvetly' }

/** Open Graph wants `en_GB`, not the `en-GB` of hreflang. */
const ogLocale = (languageTag: string) => languageTag.replace('-', '_')

/**
 * A page's title and description, its canonical and language links, and the same words for link previews.
 * Next merges `openGraph` and `twitter` shallowly, so every page sets them whole rather than inheriting the layout's.
 */
export function pageMetadata(
  lang: Locale,
  path: string,
  title: string | { absolute: string },
  description: string,
): Metadata {
  const fullTitle = typeof title === 'string' ? TITLE_TEMPLATE.replace('%s', title) : title.absolute
  return {
    alternates: localizedAlternates(path, lang),
    title,
    description,
    openGraph: {
      type: 'website',
      siteName: 'Helvetly',
      title: fullTitle,
      description,
      url: localizedHref(path, lang),
      locale: ogLocale(localeDetails(lang).languageTag),
      alternateLocale: Object.entries(locales)
        .filter(([code]) => code !== lang)
        .map(([, { languageTag }]) => ogLocale(languageTag)),
      images: [IMAGE],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [IMAGE] },
  }
}
