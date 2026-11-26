import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { listItem, sampleInvoice, sampleSummary } from '@/test/invoice-api'

import { ClientInvoices } from './client-invoices'

const server = setupServer(
  http.get('/api/v1/invoices', () =>
    HttpResponse.json({ data: [listItem(sampleInvoice())], meta: { total: 1 } }),
  ),
  http.get('/api/v1/instalment-plans', () => HttpResponse.json({ data: [] })),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('the client card shows each outstanding currency, including when the workspace balance is zero', async () => {
  const balances = ['EUR', 'USD'].map((currency) => ({
    currency,
    outstanding: { amount: '216.20', count: 1 },
    overdue: { amount: '0.00', count: 0 },
  }))
  server.use(
    http.get('/api/v1/invoices/summary', () =>
      HttpResponse.json({
        data: {
          ...sampleSummary,
          outstanding: { amount: '0.00', count: 0 },
          open_balances: balances,
        },
      }),
    ),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClientInvoices clientId="cli_1" />
    </QueryClientProvider>,
  )
  const euro = await screen.findByText(/EUR.*216|216.*EUR/)
  expect(within(euro.closest('section')!).getByText(/USD.*216|216.*USD/)).toBeInTheDocument()
  expect(screen.queryByText(/every invoice is settled/i)).not.toBeInTheDocument()
})
