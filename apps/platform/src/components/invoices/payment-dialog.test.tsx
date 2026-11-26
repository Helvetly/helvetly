import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { invoiceKeys } from '@/lib/invoices'
import { listItem, sampleInvoice, sampleSettings } from '@/test/invoice-api'

import { PaymentDialog } from './invoice-dialogs'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

test('a lost payment response keeps its identity after the balance refreshes; the next payment gets its own', async () => {
  const invoice = sampleInvoice({ status: 'open', amount_due: '216.20' })
  const recorded = { ...invoice, amount_due: '66.20' }
  const requests: string[] = []
  server.use(
    http.get('/api/v1/invoices/:id', () => HttpResponse.json({ data: invoice })),
    http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
    http.post<never, { request_id: string }>(
      '/api/v1/invoices/:id/payments',
      async ({ request }) => {
        requests.push((await request.json()).request_id)
        return requests.length === 1 ? HttpResponse.error() : HttpResponse.json({ data: recorded })
      },
    ),
  )
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const onClose = vi.fn<() => void>()
  const open = () =>
    render(
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <PaymentDialog invoice={listItem(invoice)} onClose={onClose} />
        </TooltipProvider>
      </QueryClientProvider>,
    )
  const first = open()
  const amount = screen.getByRole('textbox', { name: /Amount/ })
  await userEvent.clear(amount)
  await userEvent.type(amount, '150.00')
  const submit = screen.getByRole('button', { name: 'Record payment' })
  await userEvent.click(submit)
  await waitFor(() => expect(requests).toHaveLength(1))
  act(() => {
    cache.setQueryData(invoiceKeys.detail(invoice.id), recorded)
  })
  await waitFor(() => expect(submit).toBeEnabled())
  await userEvent.click(submit)
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  first.unmount()
  open()
  await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))
  await waitFor(() => expect(requests).toHaveLength(3))
  expect(requests[0]).toBeTruthy()
  expect(requests[1]).toBe(requests[0])
  expect(requests[2]).not.toBe(requests[0])
})

/** Records a payment with the setting given, the box clicked once or left alone; answers the request body. */
const record = async (paymentConfirmation: boolean, click: boolean) => {
  const invoice = sampleInvoice({ status: 'open', amount_due: '216.20' })
  const bodies: Record<string, unknown>[] = []
  server.use(
    http.get('/api/v1/invoices/:id', () => HttpResponse.json({ data: invoice })),
    http.get('/api/v1/invoice-settings', () =>
      HttpResponse.json({ data: sampleSettings({ payment_confirmation: paymentConfirmation }) }),
    ),
    http.post<never, Record<string, unknown>>(
      '/api/v1/invoices/:id/payments',
      async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ data: { ...invoice, status: 'paid', amount_due: '0.00' } })
      },
    ),
  )
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={cache}>
      <TooltipProvider>
        <PaymentDialog invoice={listItem(invoice)} onClose={() => {}} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  const box = screen.getByRole('checkbox', { name: 'Send payment confirmation to the client' })
  await waitFor(() => expect(box).toHaveAttribute('aria-checked', String(paymentConfirmation)))
  if (click) await userEvent.click(box)
  await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))
  await waitFor(() => expect(bodies).toHaveLength(1))
  return bodies[0]
}

describe('the payment confirmation checkbox', () => {
  test('starts as the setting and, untouched, leaves the choice to it', async () => {
    expect(await record(true, false)).not.toHaveProperty('notify_client')
  })

  test('unticked, the payment goes without a confirmation', async () => {
    expect(await record(true, true)).toMatchObject({ notify_client: false })
  })

  test('ticked with the setting off, the client still gets one', async () => {
    expect(await record(false, true)).toMatchObject({ notify_client: true })
  })
})
