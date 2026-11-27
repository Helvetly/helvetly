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
  // An admin holds payroll view by default (ADMIN_HR), which opens the module's list and register.
  expect(labels(effectiveScopes('admin', undefined))).toContain('Employees')
  expect(labels(effectiveScopes('owner', undefined))).toEqual(
    expect.arrayContaining(['Members', 'Employees']),
  )
  expect(labels(['read:employees'])).toContain('Employees')
})

test('payroll view alone shows Employees: the list serves picking employees by name', () => {
  expect(labels(['read:payroll'])).toContain('Employees')
  expect(labels(['read:clients'])).not.toContain('Employees')
})

test('Employees stays in the menu on every plan: its page offers the plan that has it', () => {
  expect(labels(effectiveScopes('owner', undefined))).toContain('Employees')
  expect(labels(effectiveScopes('member', undefined))).not.toContain('Employees')
})

const booksHref = (scopes: readonly string[]) =>
  visibleNav(scopes)
    .flatMap((group) => group.items)
    .find((item) => item.label === 'Books')?.href

test('Books links to the first of its tabs the person may read, and hides without any', () => {
  expect(booksHref(['*:*'])).toBe('/books')
  expect(booksHref(['read:ledger'])).toBe('/books/ledger')
  expect(booksHref(['read:vat-return', 'read:ledger'])).toBe('/books/vat-return')
  expect(booksHref(['read:clients'])).toBeUndefined()
})

test('Scheduling sits right under the dashboard and needs read:scheduling', () => {
  const first = visibleNav(['*:*'])[0]?.items.map((item) => item.label)
  expect(first?.slice(0, 2)).toEqual(['Dashboard', 'Scheduling'])
  expect(labels(['read:scheduling'])).toContain('Scheduling')
  expect(labels(['read:clients'])).not.toContain('Scheduling')
  const item = visibleNav(['*:*'])
    .flatMap((group) => group.items)
    .find((entry) => entry.label === 'Scheduling')
  expect(item).toMatchObject({ href: '/scheduling', feature: 'scheduling' })
  expect(item?.badge).toBeDefined()
})

const bottom = (scopes: readonly string[]) =>
  visibleNav(scopes)
    .find((group) => group.bottom)
    ?.items.map((item) => item.label)

test('API & MCP sits right under Ask Heidi and needs read:api, as its settings tab did', () => {
  expect(bottom(['*:*'])).toEqual(['Ask Heidi', 'API & MCP', 'Notifications'])
  expect(
    visibleNav(['read:api'])
      .flatMap((group) => group.items)
      .find((item) => item.label === 'API & MCP')?.href,
  ).toBe('/developers')
  expect(bottom(['read:clients'])).toEqual(['Ask Heidi', 'Notifications'])
})
