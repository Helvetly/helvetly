import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Session } from '@/lib/api'
import { billingKeys, type Billing } from '@/lib/billing'

import { PlanGate } from './plan-gate'

let pathname = '/clients'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn<() => void>() }),
}))

const session: Session = {
  user: { id: 'usr_1', email: 'anna@example.ch', name: 'Anna', avatar_url: null },
  workspace: { id: 'wsp_1', name: 'Acme' },
  role: 'owner',
  onboarded: true,
  csrf_token: 't',
}

function renderGate(billing?: Billing) {
  const client = new QueryClient()
  if (billing) client.setQueryData(billingKeys.overview, billing)
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <PlanGate session={session}>
          <p>The list</p>
        </PlanGate>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  pathname = '/clients'
})

test('a locked workspace shows its plans to an owner or admin', () => {
  renderGate(billingFixture())
  expect(screen.queryByText('The list')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Choose a plan for Acme' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Basic' })).toBeVisible()
})

test('a member is told to ask an owner', () => {
  renderGate(billingFixture({ can_manage: false }))
  expect(screen.queryByText('The list')).toBeNull()
  expect(screen.getByText('This workspace has no active plan')).toBeVisible()
  expect(screen.getByText(/until an owner or admin chooses one/)).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Basic' })).toBeNull()
})

test('the billing settings are never gated', () => {
  pathname = '/settings/billing'
  renderGate(billingFixture())
  expect(screen.getByText('The list')).toBeVisible()
})

test('a workspace with a plan, billing off, or billing not loaded yet is not gated', () => {
  renderGate(billingFixture({ locked: false, plan: 'basic', status: 'active' }))
  expect(screen.getByText('The list')).toBeVisible()
})

test('billing off is not gated', () => {
  renderGate(billingFixture({ enabled: false, locked: false }))
  expect(screen.getByText('The list')).toBeVisible()
})

test('before billing loads the page shows', () => {
  renderGate()
  expect(screen.getByText('The list')).toBeVisible()
})
