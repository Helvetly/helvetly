import { vi } from 'vitest'

vi.mock('@helvetly/i18n/locales.json', () => ({
  default: {
    defaultLocale: 'en',
    locales: {
      en: { name: 'English', languageTag: 'en-GB', numberLocale: 'de-CH' },
      de: { name: 'Deutsch', languageTag: 'de-DE', numberLocale: 'de-DE' },
    },
  },
}))

import { loginHref, safeNextPath } from './safe'

test.each([
  ['/settings/security?tab=1#x', '/settings/security?tab=1#x'],
  [null, '/'],
  ['', '/'],
  ['settings', '/'],
  ['//evil.example', '/'],
  ['/\\evil.example', '/'],
  ['/\t/evil.example', '/'],
  ['https://evil.example/', '/'],
  ['/login', '/'],
  ['/login/?next=/x', '/'],
  ['/de/login', '/'],
  ['/pt-BR/login/?next=/invoices', '/'],
  ['/de/invoices?state=open', '/invoices?state=open'],
  ['/de/invoices?state=open#total', '/invoices?state=open#total'],
  ['/de?state=open#total', '/?state=open#total'],
  ['/de', '/'],
])('safeNextPath(%j) is %j', (next, expected) => {
  expect(safeNextPath(next)).toBe(expected)
})

test('loginHref keeps the way back, except to the dashboard', () => {
  expect(loginHref('/settings/security')).toBe('/login?next=%2Fsettings%2Fsecurity')
  expect(loginHref('/')).toBe('/login')
})

test('login redirects give Next.js an unprefixed next path', () => {
  expect(loginHref('/de/settings/security')).toBe('/login?next=%2Fsettings%2Fsecurity')
})
