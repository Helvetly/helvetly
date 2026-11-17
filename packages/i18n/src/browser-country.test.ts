import { beforeEach, describe, expect, it } from 'vitest'

import { browserLocale, languageStorageKey } from './browser-locale'

// Uses the real locales.json: de, en, fr, it.
describe('first language from the visitor country', () => {
  beforeEach(() => localStorage.clear())

  it.each([
    ['CH', ['pl-PL', 'en'], 'de'],
    ['CH', ['en', 'fr-CH'], 'fr'],
    ['ch', ['it'], 'it'],
    ['AT', ['fr'], 'de'],
    ['FR', [], 'fr'],
    ['PL', ['it-IT'], 'it'],
    ['', ['fr-FR'], 'fr'],
    ['US', ['pl'], 'en'],
  ])('%s with browser %j gives %s', (country, languages, want) => {
    expect(browserLocale('', localStorage, languages, country)).toBe(want)
  })

  it('never overrides a saved choice or a language link', () => {
    localStorage.setItem(languageStorageKey, 'en')
    expect(browserLocale('', localStorage, ['de'], 'CH')).toBe('en')
    expect(browserLocale('?lang=it', localStorage, ['de'], 'CH')).toBe('it')
  })
})
