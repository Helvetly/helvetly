import { defaultLocale, isLocale, locales, localizedHref } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'

export function publicRedirects(paths: string[]) {
  return Object.keys(locales)
    .filter(isLocale)
    .filter((lang) => lang !== defaultLocale)
    .flatMap((lang) =>
      paths.flatMap((path) => {
        const old = localizedHref(path, lang)
        const destination = publicHref(path, lang)
        if (old === destination) return []
        return [old + '.html', old + '/', old].map((source) => ({
          source,
          destination,
          statusCode: 301,
        }))
      }),
    )
}
