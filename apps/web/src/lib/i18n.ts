import { createTranslators, defaultLocale, isLocale, type Locale } from '@helvetly/i18n'
import { notFound } from 'next/navigation'

import de from '../messages/de.json'
import en from '../messages/en.json'

export const translatorFor = createTranslators({ en, de })
export type Translate = ReturnType<typeof translatorFor>
export type MessageKey = Parameters<Translate>[0]

/** The page's language from its route: English routes have no `lang` segment. */
export async function languageOf(params: Promise<{ lang?: string }>): Promise<Locale> {
  const { lang = defaultLocale } = await params
  if (!isLocale(lang)) notFound()
  return lang
}

/** Values worded in a language, built once per language on first use. */
export function perLanguage<T>(build: (translate: Translate, language: Locale) => T) {
  const built = new Map<Locale, T>()
  return (language: Locale): T => {
    const cached = built.get(language)
    if (cached !== undefined) return cached
    const value = build(translatorFor(language), language)
    built.set(language, value)
    return value
  }
}
