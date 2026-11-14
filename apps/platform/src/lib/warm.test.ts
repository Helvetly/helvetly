import { QueryClient } from '@tanstack/react-query'

import { clientListQuery, parseListParams as clientParams } from '@/lib/clients'
import { expenseListQuery, parseListParams as expenseParams } from '@/lib/expenses'
import { invoiceListQuery, parseListParams as invoiceParams } from '@/lib/invoices'
import { productListQuery, parseListParams as productParams } from '@/lib/products'

import { warmPage } from './warm'

const fresh = new URLSearchParams()

// A warmed query helps only if it is the one the page asks for on a fresh visit.
test.each([
  ['/clients', clientListQuery(clientParams(fresh)).queryKey],
  ['/invoices', invoiceListQuery(invoiceParams(fresh)).queryKey],
  ['/products', productListQuery(productParams(fresh)).queryKey],
  ['/expenses', expenseListQuery(expenseParams(fresh)).queryKey],
])('warms the list %s loads on a fresh visit', (href, queryKey) => {
  const queryClient = new QueryClient()
  warmPage(queryClient, href)
  expect(queryClient.getQueryCache().find({ queryKey, exact: true })).toBeDefined()
})

test('a page without a list warms nothing', () => {
  const queryClient = new QueryClient()
  warmPage(queryClient, '/settings')
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
})
