import { IntlMessageFormat } from 'intl-messageformat'

import { currentBrowserLocale } from './browser-locale'
import configuration from './locales.json'

export {
  browserLocale,
  currentBrowserLocale,
  languageHref,
  languageStorageKey,
} from './browser-locale'

export type Locale = keyof typeof configuration.locales
const configured = (value: string): value is Locale => Object.hasOwn(configuration.locales, value)
const configuredDefault = configuration.defaultLocale
if (!configured(configuredDefault))
  throw new Error(`Default locale is not enabled: ${configuredDefault}`)
export const defaultLocale = configuredDefault
export const browserLanguage = process.env.NEXT_PUBLIC_I18N_MODE === 'browser'
export const locales = Object.fromEntries(
  Object.entries(configuration.locales).filter(
    ([language]) => !browserLanguage || configuration.browserLocales.includes(language),
  ),
)

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(locales, value)
}

const configuredLocale =
  browserLanguage && typeof window !== 'undefined'
    ? currentBrowserLocale()
    : (process.env.NEXT_PUBLIC_LOCALE ?? defaultLocale)
export const locale = isLocale(configuredLocale) ? configuredLocale : 'en'
export const languageTag = configuration.locales[locale].languageTag
export const numberLocale = configuration.locales[locale].numberLocale
/** The language's tag and number format, for a page built in that language. */
export function localeDetails(language: Locale) {
  return configuration.locales[language]
}
export const localePrefix = browserLanguage || locale === defaultLocale ? '' : `/${locale}`

type Catalogs<Messages extends Record<string, string>> = { en: Messages } & Partial<
  Record<Locale, Partial<Record<keyof Messages, string>>>
>

/** The language stays fixed for the lifetime of the page, including module-level labels. */
export function createMessages<const Messages extends Record<string, string>>(
  catalogs: Catalogs<Messages>,
) {
  return createTranslators(catalogs)(locale)
}

/** One translator per language, for pages that render several languages in one build. */
export function createTranslators<const Messages extends Record<string, string>>(
  catalogs: Catalogs<Messages>,
) {
  const translators = new Map<Locale, ReturnType<typeof createTranslator<Messages>>>()
  return (language: Locale) => {
    let translator = translators.get(language)
    if (!translator) {
      translator = createTranslator(catalogs.en, language, catalogs[language])
      translators.set(language, translator)
    }
    return translator
  }
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
  language: string = browserLanguage ? defaultLocale : locale,
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

export function localizedAlternates(path: string, language: Locale) {
  return {
    canonical: localizedHref(path, language),
    languages: {
      ...Object.fromEntries(
        Object.entries(locales).map(([code, details]) => [
          details.languageTag,
          localizedHref(path, code),
        ]),
      ),
      'x-default': localizedHref(path, defaultLocale),
    },
  }
}
