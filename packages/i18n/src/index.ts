import { IntlMessageFormat } from 'intl-messageformat'

import configuration from './locales.json'

export const defaultLocale = configuration.defaultLocale
export const locales = configuration.locales
export type Locale = keyof typeof locales

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(locales, value)
}

const configuredLocale = process.env.NEXT_PUBLIC_LOCALE ?? defaultLocale
export const locale = isLocale(configuredLocale) ? configuredLocale : 'en'
export const languageTag = locales[locale].languageTag
export const numberLocale = locales[locale].numberLocale
export const localePrefix = locale === defaultLocale ? '' : `/${locale}`

/** Each static export has its own fixed locale, including server-rendered text and metadata. */
export function createMessages<const Messages extends Record<string, string>>(
  catalogs: { en: Messages } & Partial<Record<Locale, Partial<Record<keyof Messages, string>>>>,
) {
  return createTranslator(catalogs.en, locale, catalogs[locale])
}

export function createTranslator<const Messages extends Record<string, string>>(
  english: Messages,
  language: string,
  translated: Partial<Record<keyof Messages, string>> = {},
) {
  const messages = { ...english, ...translated }
  const formats = new Map<string, IntlMessageFormat>()

  return (key: keyof Messages & string, values: Record<string, unknown> = {}): string => {
    let format = formats.get(key)
    if (!format) {
      const message = messages[key]
      if (message === undefined) throw new Error(`Missing translation: ${language}/${key}`)
      format = new IntlMessageFormat(message, language, undefined, { ignoreTag: true })
      formats.set(key, format)
    }

    const result = format.format(
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          typeof value === 'number'
            ? value
            : value instanceof Date
              ? value.getTime()
              : String(value ?? ''),
        ]),
      ),
    )

    return Array.isArray(result) ? result.join('') : String(result)
  }
}

/** Prefix application routes, preserving API, external, fragment and already-localized URLs. */
export function localizedHref(href: string, language?: string): string
export function localizedHref(href: string | undefined, language?: string): string | undefined
export function localizedHref(
  href: string | undefined,
  language: string = locale,
): string | undefined {
  if (href === undefined) return undefined
  if (
    !href.startsWith('/') ||
    href.startsWith('//') ||
    (/^\/(api|_next)(\/|\?|#|$)/.test(href) && !/^\/api\/reference(\/|\?|#|$)/.test(href))
  )
    return href

  const first = href.split(/[/?#]/)[1] ?? ''
  const remainder = href.slice(first.length + 1)
  const path =
    isLocale(first) && first !== defaultLocale
      ? remainder.startsWith('/')
        ? remainder
        : `/${remainder}`
      : href
  return language === defaultLocale ? path : `/${language}${path === '/' ? '/' : path}`
}

export function localizedAlternates(path: string) {
  return {
    canonical: localizedHref(path),
    languages: {
      ...Object.fromEntries(
        Object.entries(locales).map(([language, details]) => [
          details.languageTag,
          localizedHref(path, language),
        ]),
      ),
      'x-default': localizedHref(path, defaultLocale),
    },
  }
}
