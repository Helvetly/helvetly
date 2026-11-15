import { describe, expect, it } from 'vitest'

import { createTranslator, localizedHref } from './index'

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
