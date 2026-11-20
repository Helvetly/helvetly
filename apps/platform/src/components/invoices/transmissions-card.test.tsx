import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { type Transmission, transmissionsKey } from '@/lib/transmissions'

import { TransmissionsCard } from './transmissions-card'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const failed: Transmission = {
  id: 'trn_1',
  invoice_id: 'inv_1',
  channel: 'export',
  format: 'xrechnung-ubl',
  status: 'failed',
  external_id: null,
  attempts: 8,
  last_error: 'provider unavailable',
  created_at: '2026-11-09T10:00:00Z',
  updated_at: '2026-11-09T11:00:00Z',
  next_attempt_at: null,
}

function show(list: Transmission[], canManage = true) {
  let retried = ''
  server.use(
    http.get('/api/v1/invoices/inv_1/transmissions', () => HttpResponse.json({ data: list })),
    http.post('/api/v1/invoices/inv_1/transmissions/:tid/retry', ({ params }) => {
      retried = String(params.tid)
      return HttpResponse.json({ data: { ...failed, status: 'queued' } }, { status: 202 })
    }),
  )
  const queries = new QueryClient()
  render(
    <QueryClientProvider client={queries}>
      <TransmissionsCard invoiceId="inv_1" canManage={canManage} />
    </QueryClientProvider>,
  )
  return Object.assign(() => retried, { queries })
}

test('a failed transmission shows why and can be retried', async () => {
  const retried = show([failed])
  expect(await screen.findByText('export · xrechnung-ubl')).toBeVisible()
  expect(screen.getByText('provider unavailable')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(retried()).toBe('trn_1'))
})

test('an accepted one shows the channel id and no retry; members without rights get no retry', async () => {
  show(
    [
      { ...failed, id: 'trn_2', status: 'accepted', external_id: 'msg-42', last_error: null },
      failed,
    ],
    false,
  )
  expect(await screen.findByText(/Accepted · .* · msg-42/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
})

test('nothing shows without transmissions', async () => {
  const { queries } = show([])
  await waitFor(() =>
    expect(queries.getQueryState(transmissionsKey('inv_1'))?.status).toBe('success'),
  )
  expect(screen.queryByText('E-invoice transmissions')).not.toBeInTheDocument()
})
