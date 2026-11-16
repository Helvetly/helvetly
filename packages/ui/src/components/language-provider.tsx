'use client'

import { locale, type Locale } from '@helvetly/i18n'
import { translatorFor } from '@helvetly/ui/lib/i18n'
import { createContext, type ReactNode, use } from 'react'

// Without a provider (platform, portal) the page's own language applies, as before.
const LanguageContext = createContext<Locale>(locale)

/** The language of a page that is built in several languages (the website), for the controls inside. */
export function LanguageProvider({
  language,
  children,
}: {
  language: Locale
  children: ReactNode
}) {
  return <LanguageContext value={language}>{children}</LanguageContext>
}

export function useLanguage(): Locale {
  return use(LanguageContext)
}

export function useTranslate() {
  return translatorFor(useLanguage())
}
