import { defaultLocale, isLocale, type Locale, locales, localizedAlternates } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'

import { compareIn } from '@/lib/compare'
import { hasArticleTranslation, readCollection } from '@/lib/content'
import { topicsWithArticles } from '@/lib/help-topics'
import { hasLegalTranslation, isLegalSlug, LEGAL } from '@/lib/legal'

export function publicAlternates(path: string, language: Locale) {
  const [, section, slug, ...rest] = path.split('/')
  const available = Object.keys(locales)
    .filter(isLocale)
    .filter((code) => {
      if (code === defaultLocale) return true
      if ((section === 'guides' || section === 'help') && slug && !rest.length)
        return hasArticleTranslation(section, slug, code)
      if (section && isLegalSlug(section) && !slug) return hasLegalTranslation(section, code)
      return true
    })

  // Readers can still open an English fallback, but only translations belong in the hreflang cluster.
  return localizedAlternates(
    path,
    available.includes(language) ? language : defaultLocale,
    publicHref,
    available,
  )
}

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
