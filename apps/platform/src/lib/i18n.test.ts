import configuration from '@helvetly/i18n/locales.json'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.resetModules()
})

describe('platform languages', () => {
  it('offers only the application languages', () => {
    expect(configuration.browserLocales).toEqual(['de', 'en', 'fr', 'it'])
  })

  it.each(['nl', 'cs', 'sv'])('keeps public-only %s out of the application', async (language) => {
    vi.stubEnv('NEXT_PUBLIC_I18N_MODE', 'browser')
    window.history.replaceState(null, '', `/clients?lang=${language}`)
    localStorage.setItem('helvetly.language', language)
    vi.resetModules()
    const { translate } = await import('./i18n')
    const { locales } = await import('@helvetly/i18n')
    expect(translate('settings')).toBe('Settings')
    expect(Object.keys(locales)).toEqual(configuration.browserLocales)
  })

  it.each([
    ['en', 'Settings', 'March 2026', 'Third reminder'],
    ['de', 'Einstellungen', 'März 2026', 'Dritte Erinnerung'],
    ['fr', 'Paramètres', 'mars 2026', 'Troisième rappel'],
    ['it', 'Impostazioni', 'marzo 2026', 'Terzo promemoria'],
  ])(
    'loads the %s catalog from a language link and remembers it',
    async (language, label, month, thirdReminder) => {
      vi.stubEnv('NEXT_PUBLIC_I18N_MODE', 'browser')
      window.history.replaceState(null, '', `/clients?lang=${language}`)
      vi.resetModules()

      const { translate } = await import('./i18n')
      const { monthLabel } = await import('./payroll')
      expect(translate('settings')).toBe(label)
      expect(translate('reminder', { rank: 3 })).toBe(thirdReminder)
      expect(monthLabel('2026-03')).toBe(month)
      expect(localStorage.getItem('helvetly.language')).toBe(language)
    },
  )
})
