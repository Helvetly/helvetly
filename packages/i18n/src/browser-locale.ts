import configuration from './locales.json'

export const languageStorageKey = 'helvetly.language'

type Locale = keyof typeof configuration.locales
const supported = (value: string | null): value is Locale =>
  value !== null && configuration.browserLocales.includes(value)

// Countries that speak one language of the application; Switzerland speaks three of them.
const countryLanguages: Record<string, readonly string[]> = {
  AT: ['de'],
  BE: ['fr'],
  CH: ['de', 'fr', 'it'],
  DE: ['de'],
  FR: ['fr'],
  IT: ['it'],
  LI: ['de'],
  LU: ['fr'],
  MC: ['fr'],
  SM: ['it'],
  VA: ['it'],
}

const primary = (tag: string) => tag.slice(0, 2).toLowerCase()

/**
 * An explicit link wins over the saved preference, then the visitor's country (the browser's languages pick among a
 * multilingual country's, else its first), then the browser's languages; blocked storage still permits language links.
 */
export function browserLocale(
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  languages: readonly string[] = [],
  country = '',
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
  const spoken = (countryLanguages[country.toUpperCase()] ?? []).filter(supported)
  const preferred = languages.map(primary)
  for (const language of preferred) {
    const local = spoken.find((s) => s === language)
    if (local) return local
  }
  if (spoken[0]) return spoken[0]
  return preferred.find(supported) ?? 'en'
}

/** The country the server read from Cloudflare (apps/api/internal/platform, CountryCookie). */
function visitorCountry(cookie: string): string {
  return /(?:^|;\s*)helvetly_country=([A-Z]{2})(?:;|$)/.exec(cookie)?.[1] ?? ''
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
    visitorCountry(document.cookie),
  )
}

export function languageHref(href: string, language: string): string {
  const url = new URL(href, 'https://helvetly.invalid')
  url.searchParams.set('lang', language)
  return url.pathname + url.search + url.hash
}
