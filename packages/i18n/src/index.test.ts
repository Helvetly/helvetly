import { describe, expect, it } from 'vitest'

import {
  browserLocale,
  createTranslator,
  createTranslators,
  isLocale,
  localeDetails,
  localizedAlternates,
  localizedHref,
} from './index'
import configuration from './locales.json'

describe('translations', () => {
  const english = {
    greeting: 'Hello, {name}.',
    invoices: '{count, plural, =0 {No invoices} one {# invoice} other {# invoices}}',
    saved: 'Saved',
  }

  it('formats values and plural rules using the requested language', () => {
    const t = createTranslator(english, 'pl', {
      invoices:
        '{count, plural, one {# faktura} few {# faktury} many {# faktur} other {# faktury}}',
    })
    expect(t('greeting', { name: 'Piotr' })).toBe('Hello, Piotr.')
    expect(t('invoices', { count: 1 })).toBe('1 faktura')
    expect(t('invoices', { count: 2 })).toBe('2 faktury')
    expect(t('invoices', { count: 5 })).toBe('5 faktur')
    expect(t('saved')).toBe('Saved')
  })

  it('keeps translators isolated and treats interpolated input as text', () => {
    const englishT = createTranslator(english, 'en')
    const germanT = createTranslator(english, 'de', { saved: 'Gespeichert' })
    expect(germanT('saved')).toBe('Gespeichert')
    expect(englishT('saved')).toBe('Saved')
    expect(englishT('greeting', { name: '<script>{name}</script>' })).toBe(
      'Hello, <script>{name}</script>.',
    )
    expect(englishT('invoices', { count: 0 })).toBe('No invoices')
  })
})

describe('translators per language', () => {
  it('keeps one translator per language, with English for missing messages', () => {
    const translatorFor = createTranslators({
      en: { saved: 'Saved', title: 'Invoices' },
      de: { saved: 'Gespeichert' },
    })
    expect(translatorFor('de')('saved')).toBe('Gespeichert')
    expect(translatorFor('de')('title')).toBe('Invoices')
    expect(translatorFor('en')('saved')).toBe('Saved')
    expect(translatorFor('de')).toBe(translatorFor('de'))
  })
})

describe('localizedAlternates', () => {
  it('names the page in its own language and links every language', () => {
    expect(localizedAlternates('/pricing', 'de')).toEqual({
      canonical: '/de/pricing',
      languages: {
        'de-CH': '/de/pricing',
        'en-GB': '/pricing',
        'fr-CH': '/fr/pricing',
        'it-CH': '/it/pricing',
        'x-default': '/pricing',
      },
    })
    expect(localizedAlternates('/', 'en').canonical).toBe('/')
  })
})

describe('localizedHref', () => {
  it('preserves routes, query strings and fragments when changing language', () => {
    expect(localizedHref('/invoices?state=open#total', 'de')).toBe('/de/invoices?state=open#total')
    expect(localizedHref('/', 'de')).toBe('/de/')
    expect(localizedHref('/api/reference/invoices', 'de')).toBe('/de/api/reference/invoices')
    expect(localizedHref('/invoices', 'en')).toBe('/invoices')
  })

  it.each([
    '/api/invoices',
    '/api?test=1',
    '/_next/static/a.js',
    '//example.com/a',
    'https://example.com/a',
    '#features',
    'mailto:a@example.com',
  ])('preserves %s', (href) => expect(localizedHref(href, 'de')).toBe(href))
})

describe('public languages', () => {
  it.each([
    ['fr', 'Français', 'fr-CH'],
    ['it', 'Italiano', 'it-CH'],
  ])(
    'publishes %s on the website as a Swiss language with Swiss number formats',
    (code, name, tag) => {
      if (!isLocale(code)) throw new Error(`${code} is not a public language`)
      expect(localeDetails(code)).toEqual({
        name,
        languageTag: tag,
        numberLocale: 'de-CH',
      })
      expect(localizedHref('/pricing#basic', code)).toBe(`/${code}/pricing#basic`)
      expect(localizedHref(`/${code}/pricing`, 'en')).toBe('/pricing')
    },
  )

  it('keeps the application in English when a public page hands over ?lang', () => {
    expect(configuration.browserLocales).toEqual(['en'])
    const storage = new Map<string, string>()
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    }
    for (const language of ['de', 'fr', 'it'])
      expect(browserLocale(`?lang=${language}`, store)).toBe('en')
    expect(storage.size).toBe(0)
  })
})
