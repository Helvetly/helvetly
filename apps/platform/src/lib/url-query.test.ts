import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@helvetly/i18n/locales.json', () => ({
  default: {
    defaultLocale: 'en',
    locales: {
      en: { name: 'English', languageTag: 'en-GB', numberLocale: 'de-CH' },
      de: { name: 'Deutsch', languageTag: 'de-DE', numberLocale: 'de-DE' },
    },
  },
}))

afterEach(() => vi.unstubAllEnvs())

test.each([false, true])(
  'preserves the locale when updating the address (push=%s)',
  async (push) => {
    vi.stubEnv('NEXT_PUBLIC_LOCALE', 'de')
    vi.resetModules()
    const { setUrlQuery } = await import('./url-query')
    const method = vi.spyOn(window.history, push ? 'pushState' : 'replaceState')
    setUrlQuery('/invoices', new URLSearchParams({ id: 'inv_1' }), push)
    expect(method).toHaveBeenLastCalledWith(null, '', '/de/invoices?id=inv_1')
    setUrlQuery('/de/invoices', new URLSearchParams(), push)
    expect(method).toHaveBeenLastCalledWith(null, '', '/de/invoices')
    method.mockRestore()
  },
)
