import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Session } from '@/lib/api'
import { billingKeys, type Billing } from '@/lib/billing'
import { queryKeys } from '@/lib/queries'

import { ChoosePlan, PlanGate } from './plan-gate'

const server = setupServer()
beforeAll(() => server.listen())
afterAll(() => server.close())

let pathname = '/clients'
const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}))

const session: Session = {
  user: { id: 'usr_1', email: 'anna@example.ch', name: 'Anna', avatar_url: null },
  workspace: { id: 'wsp_1', name: 'Acme' },
  role: 'owner',
  onboarded: true,
  csrf_token: 't',
}

function renderWith(node: ReactNode, billing?: Billing) {
  // Billing never answers in these tests unless it is seeded.
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: () => new Promise(() => {}), retry: false } },
  })
  client.setQueryData(queryKeys.session, session)
  if (billing) client.setQueryData(billingKeys.overview, billing)
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  )
}

const gate = (billing?: Billing) =>
  renderWith(
    <PlanGate>
      <p>The list</p>
    </PlanGate>,
    billing,
  )

afterEach(() => {
  pathname = '/clients'
  replace.mockClear()
})

test('a locked workspace goes to the plan picker without showing the page', () => {
  gate(billingFixture())
  expect(screen.queryByText('The list')).toBeNull()
  expect(replace).toHaveBeenCalledWith('/choose-plan')
})

test('before billing loads the page does not show', () => {
  gate()
  expect(screen.queryByText('The list')).toBeNull()
  expect(screen.getByText('Loading…')).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
})

test('the billing settings are never gated', () => {
  pathname = '/settings/billing'
  gate(billingFixture())
  expect(screen.getByText('The list')).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
})

test('a workspace with a plan is not gated', () => {
  gate(billingFixture({ locked: false, plan: 'basic', status: 'active' }))
  expect(screen.getByText('The list')).toBeVisible()
})

test('billing off is not gated', () => {
  gate(billingFixture({ enabled: false, locked: false }))
  expect(screen.getByText('The list')).toBeVisible()
})

test('the picker shows the plans to an owner or admin', () => {
  renderWith(<ChoosePlan />, billingFixture())
  expect(screen.getByRole('heading', { name: 'Choose a plan for Acme' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Basic' })).toBeVisible()
})

test('the picker tells a member to ask an owner', () => {
  renderWith(<ChoosePlan />, billingFixture({ can_manage: false }))
  expect(screen.getByText('This workspace has no active plan')).toBeVisible()
  expect(screen.getByText(/until an owner or admin chooses one/)).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Basic' })).toBeNull()
})

test('the picker sends a workspace with a plan home', () => {
  renderWith(<ChoosePlan />, billingFixture({ locked: false, plan: 'basic', status: 'active' }))
  expect(replace).toHaveBeenCalledWith('/')
  expect(screen.queryByRole('region', { name: 'Basic' })).toBeNull()
})

test('billing the person may not read does not hold the page', async () => {
  const client = new QueryClient()
  client.setQueryData(queryKeys.session, session)
  server.use(
    http.get('/api/v1/billing', () =>
      HttpResponse.json({ error: { code: 'forbidden', message: 'No access.' } }, { status: 403 }),
    ),
  )
  render(
    <QueryClientProvider client={client}>
      <PlanGate>
        <p>The list</p>
      </PlanGate>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('The list', {}, { timeout: 2000 })).toBeVisible()
})
