import { pageOf } from './heidi-provider'

test.each([
  ['/', 'dashboard'],
  ['/clients', 'clients'],
  ['/products', 'products'],
  ['/settings/billing', 'billing'],
  ['/settings/billing/plans', 'billing'],
  ['/settings/invoices', 'settings'],
  ['/books/ledger', 'settings'],
  ['/nowhere', 'dashboard'],
])('%s asks Heidi from %s', (path, page) => {
  expect(pageOf(path).page).toBe(page)
})
