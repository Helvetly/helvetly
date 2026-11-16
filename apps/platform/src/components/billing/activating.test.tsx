import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Billing } from '@/lib/billing'

import { Activating, isActivating } from './activating'

vi.mock('sonner', () => ({ toast: { error: vi.fn<(message: string) => void>() } }))

const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  usePathname: () => '/activating',
  useRouter: () => ({ replace }),
}))

const locked = billingFixture()
const active = billingFixture({ plan: 'pro', locked: false })

let reads: Billing[] = []
let syncs = 0
let syncFails = false
const server = setupServer(
  // The billing reads answer in turn, the last one for good; Stripe's read agrees with the next one.
  http.get('/api/v1/billing', () =>
    HttpResponse.json({ data: reads.length > 1 ? reads.shift() : reads[0] }),
  ),
  http.post('/api/v1/billing/sync', () => {
    syncs++
    return syncFails
      ? HttpResponse.json({ error: { code: 'stripe', message: 'Stripe is away' } }, { status: 502 })
      : HttpResponse.json({ data: reads[0] })
  }),
)
beforeAll(() => server.listen())
afterAll(() => server.close())
afterEach(() => {
  vi.useRealTimers()
  replace.mockClear()
  vi.mocked(toast.error).mockClear()
  reads = []
  syncs = 0
  syncFails = false
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Activating />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('reads the subscription from Stripe once and waits while the workspace is locked', async () => {
  reads = [locked]
  renderPage()
  expect(screen.getByRole('heading', { name: 'Activating your plan…' })).toBeVisible()
  expect(screen.getByText('Payment received. This takes a few seconds.')).toBeVisible()
  await waitFor(() => expect(syncs).toBe(1))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(syncs).toBe(1)
  expect(replace).not.toHaveBeenCalled()
})

test('goes to the app as soon as a later read finds the plan', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  reads = [locked, locked, active]
  renderPage()
  await waitFor(() => expect(syncs).toBe(1))
  expect(replace).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(4_000))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
})

test.each([
  ['billing is off (self-hosted)', billingFixture({ enabled: false })],
  ['the plan is already active', active],
])('goes straight on when %s', async (_, billing) => {
  reads = [billing]
  renderPage()
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
})

test('after a minute without the plan, a calm notice replaces the spinner and can check again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  reads = [locked]
  renderPage()
  await waitFor(() => expect(syncs).toBe(1))
  await act(() => vi.advanceTimersByTimeAsync(59_000))
  expect(screen.queryByText(/Your payment went through/)).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(1_000))
  expect(
    screen.getByText('Your payment went through. The plan can take a minute to appear.'),
  ).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Activating your plan…' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Go to billing' }).getAttribute('href')).toBe(
    '/settings/billing',
  )

  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(screen.getByRole('heading', { name: 'Activating your plan…' })).toBeVisible()
  await waitFor(() => expect(syncs).toBe(2))
})

test('a failed read from Stripe says why and keeps waiting', async () => {
  syncFails = true
  reads = [locked]
  renderPage()
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Stripe is away'))
  expect(screen.getByRole('heading', { name: 'Activating your plan…' })).toBeVisible()
})

test.each([
  ['/activating', true],
  ['/activating/', true],
  ['/activating/x', false],
  ['/settings/billing', false],
])('isActivating(%s) is %s', (path, want) => expect(isActivating(path)).toBe(want))
