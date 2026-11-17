import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./locales.json', () => ({
  default: {
    defaultLocale: 'en',
    browserLocales: ['en', 'pl'],
    locales: { en: {}, pl: {}, de: {} },
  },
}))

import { browserLocale, languageHref, languageStorageKey } from './browser-locale'

describe('browser language', () => {
  beforeEach(() => localStorage.clear())

  it('does not activate a public-only language in the application', () => {
    localStorage.setItem(languageStorageKey, 'de')
    expect(browserLocale('?lang=de', localStorage)).toBe('en')
    expect(browserLocale('', localStorage)).toBe('en')
  })

  it('lets the language query override storage and remembers it for later navigation', () => {
    localStorage.setItem(languageStorageKey, 'en')
    expect(browserLocale('?next=%2Finvoices&lang=pl', localStorage)).toBe('pl')
    expect(localStorage.getItem(languageStorageKey)).toBe('pl')
    expect(browserLocale('', localStorage)).toBe('pl')
    expect(browserLocale('?lang=en', localStorage)).toBe('en')
    expect(browserLocale('', localStorage)).toBe('en')
  })

  it('ignores unsupported query and saved languages and defaults to English', () => {
    localStorage.setItem(languageStorageKey, 'pl')
    expect(browserLocale('?lang=unknown', localStorage)).toBe('pl')
    localStorage.setItem(languageStorageKey, '<script>')
    expect(browserLocale('?lang=', localStorage)).toBe('en')
    localStorage.clear()
    expect(browserLocale('', localStorage)).toBe('en')
  })

  it('falls back to the first supported browser language before English', () => {
    expect(browserLocale('', localStorage, ['fr-CH', 'pl-PL', 'en-GB'])).toBe('pl')
    expect(browserLocale('', localStorage, ['fr-CH'])).toBe('en')
    localStorage.setItem(languageStorageKey, 'en')
    expect(browserLocale('', localStorage, ['pl'])).toBe('en')
    expect(browserLocale('?lang=pl', localStorage, ['en'])).toBe('pl')
  })

  it('supports explicit language links when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(browserLocale('?lang=pl', blocked)).toBe('pl')
    expect(browserLocale('', blocked)).toBe('en')
  })

  it('changes only the language parameter without adding a route prefix', () => {
    const url = new URL(
      languageHref('/invoices?state=open&lang=en&next=%2Fquotes#total', 'pl'),
      'https://example.com',
    )
    expect(url.pathname).toBe('/invoices')
    expect(url.searchParams.get('state')).toBe('open')
    expect(url.searchParams.get('next')).toBe('/quotes')
    expect(url.searchParams.getAll('lang')).toEqual(['pl'])
    expect(url.hash).toBe('#total')
  })
})

it('uses the browser language for messages while keeping application routes unprefixed', async () => {
  vi.stubEnv('NEXT_PUBLIC_I18N_MODE', 'browser')
  window.history.replaceState(null, '', '/login?lang=pl')
  vi.resetModules()
  try {
    const i18n = await import('./index')
    expect(i18n.locale).toBe('pl')
    expect(i18n.localePrefix).toBe('')
    expect(i18n.localizedHref('/invoices?state=open#total')).toBe('/invoices?state=open#total')
    expect(i18n.localizedHref('/terms', 'pl')).toBe('/pl/terms')
    const catalogs = { en: { saved: 'Saved' }, pl: { saved: 'Zapisano' } }
    const translate = i18n.createMessages(catalogs)
    expect(translate('saved')).toBe('Zapisano')
  } finally {
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    localStorage.clear()
    vi.resetModules()
  }
})
