import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { listItem, sampleInvoice } from '@/test/invoice-api'

import { PrepaymentPicker } from './prepayment-picker'

const prepayment = (id: string, deducted_on: { id: string; number: string } | null) =>
  listItem(sampleInvoice({ id, kind: 'prepayment', number: id, status: 'paid', deducted_on }))

const server = setupServer(
  http.get('/api/v1/invoices', () =>
    HttpResponse.json({
      data: [prepayment('free', null), prepayment('taken', { id: 'inv_f', number: '2026-009' })],
      meta: { total: 2, page: 1, per_page: 100 },
    }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('prepayments already deducted on another invoice are not offered', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PrepaymentPicker clientId="cli_1" currency="CHF" value={[]} onChange={() => {}} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Prepayment free')).toBeInTheDocument()
  expect(screen.queryByText('Prepayment taken')).not.toBeInTheDocument()
})

test('a paid prepayment on a later page remains selectable', async () => {
  server.use(
    http.get('/api/v1/invoices', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        data:
          page === 1
            ? [prepayment('taken', { id: 'inv_f', number: '2026-009' })]
            : [prepayment('older-free', null)],
        meta: { total: 51, page, page_size: 50, total_pages: 2 },
      })
    }),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PrepaymentPicker clientId="cli_1" currency="CHF" value={[]} onChange={() => {}} />
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Load more prepayments' }))
  expect(await screen.findByText('Prepayment older-free')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Load more prepayments' })).not.toBeInTheDocument()
})
