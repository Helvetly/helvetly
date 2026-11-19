import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import { expensesApi, useExpenseAction } from './expenses'
import { useAddPayment } from './invoices'
import { queryKeys } from './queries'

afterEach(() => vi.unstubAllGlobals())

// The dashboard's key figures (useDashboard) come from paid invoices and booked expenses.
function setup(id: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: { id } })),
  )
  const client = new QueryClient()
  client.setQueryData([...queryKeys.dashboard, 'CHF'], { outstanding: 100 })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const stale = () => client.getQueryState([...queryKeys.dashboard, 'CHF'])?.isInvalidated
  return { wrapper, stale }
}

test('recording a payment makes the key figures stale', async () => {
  const { wrapper, stale } = setup('inv_1')
  const { result } = renderHook(() => useAddPayment(), { wrapper })
  await act(() =>
    result.current.mutateAsync({
      id: 'inv_1',
      input: { amount: '100.00', paid_on: '2026-11-19', method: 'bank_transfer' },
    }),
  )
  expect(stale()).toBe(true)
})

test('booking an expense makes the key figures stale', async () => {
  const { wrapper, stale } = setup('exp_1')
  const { result } = renderHook(() => useExpenseAction((id: string) => expensesApi.book(id)), {
    wrapper,
  })
  await act(() => result.current.mutateAsync('exp_1'))
  expect(stale()).toBe(true)
})
