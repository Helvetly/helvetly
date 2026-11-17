import configuration from './locales.json'

export const languageStorageKey = 'helvetly.language'

type Locale = keyof typeof configuration.locales
const supported = (value: string | null): value is Locale =>
  value !== null && configuration.browserLocales.includes(value)

/** An explicit link wins over the saved preference, then the browser's languages; blocked storage still permits language links. */
export function browserLocale(
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  languages: readonly string[] = [],
): Locale {
  const requested = new URLSearchParams(search).get('lang')
  if (supported(requested)) {
    try {
      storage.setItem(languageStorageKey, requested)
    } catch {
      // Storage may be disabled by the browser.
    }
    return requested
  }
  try {
    const saved = storage.getItem(languageStorageKey)
    if (supported(saved)) return saved
  } catch {
    // Storage may be disabled by the browser.
  }
  for (const tag of languages) {
    const language = tag.slice(0, 2).toLowerCase()
    if (supported(language)) return language
  }
  return 'en'
}

export function currentBrowserLocale(search = window.location.search): Locale {
  // Accessing localStorage itself can throw in restricted browsing contexts.
  return browserLocale(
    search,
    {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    navigator.languages,
  )
}

export function languageHref(href: string, language: string): string {
  const url = new URL(href, 'https://helvetly.invalid')
  url.searchParams.set('lang', language)
  return url.pathname + url.search + url.hash
}
