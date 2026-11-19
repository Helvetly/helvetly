import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.resetModules()
})

describe('portal languages', () => {
  it.each(['nl', 'cs', 'sv'])('uses English for public-only %s', async (language) => {
    vi.stubEnv('NEXT_PUBLIC_I18N_MODE', 'browser')
    localStorage.setItem('helvetly.language', language)
    window.history.replaceState(null, '', `/invoices?lang=${language}`)
    vi.resetModules()
    const { translate } = await import('./i18n')
    expect(translate('clientPortal')).toBe('Client portal')
  })

  it.each([
    ['en', 'Client portal'],
    ['de', 'Kundenportal'],
    ['fr', 'Portail client'],
    ['it', 'Portale clienti'],
  ])('loads the saved %s catalog without changing application routes', async (language, label) => {
    vi.stubEnv('NEXT_PUBLIC_I18N_MODE', 'browser')
    localStorage.setItem('helvetly.language', language)
    window.history.replaceState(null, '', '/invoices?status=open#total')
    vi.resetModules()

    const { translate } = await import('./i18n')
    expect(translate('clientPortal')).toBe(label)
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/invoices?status=open#total',
    )
  })
})
