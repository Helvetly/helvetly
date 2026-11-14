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
])('safeNextPath(%j) is %j', (next, expected) => {
  expect(safeNextPath(next)).toBe(expected)
})

test('loginHref keeps the way back, except to the dashboard', () => {
  expect(loginHref('/settings/security')).toBe('/login?next=%2Fsettings%2Fsecurity')
  expect(loginHref('/')).toBe('/login')
})
