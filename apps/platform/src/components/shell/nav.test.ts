import { effectiveScopes } from '@/lib/permissions'

import { visibleNav } from './nav'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

const labels = (scopes: readonly string[]) =>
  visibleNav(scopes).flatMap((group) => group.items.map((item) => item.label))

test('everything is in the menu with full access', () => {
  expect(labels(['*:*'])).toEqual(expect.arrayContaining(['Clients', 'Invoices', 'Members']))
})

test('pages without read are left out, along with groups left empty', () => {
  const scopes = ['read:clients']
  expect(labels(scopes)).toContain('Clients')
  expect(labels(scopes)).not.toContain('Invoices')
  expect(labels(scopes)).not.toContain('Members')
  expect(visibleNav(scopes).map((group) => group.label)).not.toContain('Team')
})

test('write alone is enough to see a page; the dashboard and Heidi always stay', () => {
  expect(labels(['write:invoices'])).toEqual(
    expect.arrayContaining(['Dashboard', 'Invoices', 'Ask Heidi']),
  )
})

test('Employees needs an HR scope, which a member\'s "*" never gives', () => {
  expect(labels(['*:*'])).not.toContain('Employees')
  expect(labels(effectiveScopes('admin', undefined))).not.toContain('Employees')
  expect(labels(effectiveScopes('owner', undefined))).toEqual(
    expect.arrayContaining(['Members', 'Employees']),
  )
  expect(labels(['read:employees'])).toContain('Employees')
})

const employeesHref = (scopes: readonly string[]) =>
  visibleNav(scopes)
    .flatMap((group) => group.items)
    .find((item) => item.label === 'Employees')?.href

test('payroll alone leads Employees to the payroll register; employees keep the list', () => {
  const href = employeesHref
  expect(href(['read:payroll'])).toBe('/employees/payroll')
  expect(href(['read:employees', 'read:payroll'])).toBe('/employees')
  expect(href(['read:clients'])).toBeUndefined()
})
