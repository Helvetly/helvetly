import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import type { Plan } from '@/lib/instalments'
import { today } from '@/lib/invoices'
import { instalmentPlans } from '@/mocks/data'
import { sampleSettings } from '@/test/invoice-api'

import { PlanCard } from './plan-card'
import { PlanDialog } from './plan-dialog'

const sample = (): Plan => {
  const [first] = instalmentPlans
  if (!first) throw new Error('The mocks need a sample plan.')
  return structuredClone(first)
}
let plan = sample()
let created: unknown = null
const server = setupServer(
  http.post('/api/v1/invoices/inv_1/plan', async ({ request }) => {
    created = await request.json()
    return HttpResponse.json({ data: { ...sample(), source_invoice_id: 'inv_1' } }, { status: 201 })
  }),
  http.get('/api/v1/instalment-plans/:id', () => HttpResponse.json({ data: plan })),
  http.post('/api/v1/instalment-plans/:id/pause', () => {
    plan = { ...plan, status: 'paused' }
    return HttpResponse.json({ data: plan })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  plan = sample()
  created = null
})
afterAll(() => server.close())

const wrap = (children: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  )

test('plan dialog creates plan', async () => {
  const onCreated = vi.fn<(plan: Plan) => void>()
  wrap(
    <PlanDialog
      invoiceId="inv_1"
      settings={sampleSettings()}
      firstDue="2000-01-01"
      onClose={() => {}}
      onCreated={onCreated}
    />,
  )
  const count = screen.getByRole('textbox', { name: /Instalments/ })
  await userEvent.clear(count)
  await userEvent.type(count, '13')
  await userEvent.click(screen.getByRole('button', { name: 'Create plan' }))
  expect(screen.getByText('From 2 to 12 instalments.')).toBeInTheDocument()
  expect(created).toBeNull()

  await userEvent.clear(count)
  await userEvent.type(count, '6')
  await userEvent.click(screen.getByRole('button', { name: 'Create plan' }))
  // The settings' defaults; a past due date starts today.
  await waitFor(() =>
    expect(created).toEqual({
      count: 6,
      interval: 'monthly',
      first_due_date: today(),
      lead_days: 10,
      auto_send: true,
    }),
  )
  await waitFor(() => expect(onCreated).toHaveBeenCalled())
})

test('a draft that needs approval first is not split: the toast says so and the dialog closes', async () => {
  server.use(
    http.post('/api/v1/invoices/inv_1/plan', () =>
      HttpResponse.json(
        { error: { code: 'approval_required', message: 'Needs approval.' } },
        { status: 409 },
      ),
    ),
  )
  const error = vi.spyOn(toast, 'error')
  const onClose = vi.fn<() => void>()
  wrap(
    <PlanDialog
      invoiceId="inv_1"
      settings={sampleSettings()}
      firstDue="2000-01-01"
      onClose={onClose}
      onCreated={() => {}}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Create plan' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(error).toHaveBeenCalledWith('This draft needs approval first', {
    description: 'Submit it for approval from its details; you can issue it once it’s approved.',
  })
})

test('pause plan', async () => {
  wrap(<PlanCard planId="pln_mock_1" canManage />)
  expect(await screen.findByText(/2 of 6 issued/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: plan.items[0]?.number ?? '' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(await screen.findByText('Paused')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
})
