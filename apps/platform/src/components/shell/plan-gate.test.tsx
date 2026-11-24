import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { billingFixture, publicOfferFixture } from '@/components/billing/billing-fixture'
import type { Session } from '@/lib/api'
import { billingKeys, useBilling, type Billing } from '@/lib/billing'
import { queryKeys } from '@/lib/queries'

import { ChoosePlan, PlanGate } from './plan-gate'

vi.mock('sonner', () => ({ toast: vi.fn<(message: string) => void>() }))

// The API never answers in these tests unless a test says otherwise: what the gate shows comes from seeded data.
const server = setupServer(http.get('/api/v1/*', () => delay('infinite')))
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

let pathname = '/clients'
const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}))

const session: Session = {
  user: { id: 'usr_1', email: 'anna@example.ch', name: 'Anna', avatar_url: null },
  workspace: { id: 'wsp_1', name: 'Acme' },
  role: 'owner',
  onboarded: true,
  csrf_token: 't',
}

function renderWith(node: ReactNode, billing?: Billing, role = 'owner') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.session, { ...session, role })
  if (billing) client.setQueryData(billingKeys.overview, billing)
  client.setQueryData(['offers', 'current'], publicOfferFixture)
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  )
}

/** No plan at all, not even Free: the API no longer answers it, the gate still guards it. */
const noPlan = (over: Partial<Billing> = {}) =>
  billingFixture({ plan: '', locked: true, features: [], ...over })

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
  gate(noPlan())
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
  gate(noPlan())
  expect(screen.getByText('The list')).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
})

test('the workspace settings are never gated, so its owner can rename or delete it', () => {
  pathname = '/settings/workspace'
  gate(noPlan())
  expect(screen.getByText('The list')).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
})

test('a workspace with a plan is not gated', () => {
  gate(billingFixture({ locked: false, plan: 'basic', status: 'active' }))
  expect(screen.getByText('The list')).toBeVisible()
})

test('a workspace on Free is not gated', () => {
  gate(billingFixture())
  expect(screen.getByText('The list')).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
})

test('billing off is not gated', () => {
  gate(billingFixture({ enabled: false, locked: false }))
  expect(screen.getByText('The list')).toBeVisible()
})

test('the picker shows the plans to an owner or admin', () => {
  renderWith(<ChoosePlan />, noPlan())
  expect(screen.getByRole('heading', { name: 'Choose a plan for Acme' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(screen.getByRole('article', { name: 'Basic' })).toBeVisible()
})

test('the picker tells a member to ask an owner', () => {
  renderWith(<ChoosePlan />, noPlan({ can_manage: false }))
  expect(screen.getByText('This workspace has no active plan')).toBeVisible()
  expect(screen.getByText(/until an owner or admin chooses one/)).toBeVisible()
  expect(screen.queryByRole('article', { name: 'Basic' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Workspace settings' })).toHaveAttribute(
    'href',
    '/settings/workspace',
  )
})

test('the owner can delete the workspace from the picker, in place', () => {
  renderWith(<ChoosePlan />, noPlan({ has_customer: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))
  expect(screen.getByRole('dialog', { name: 'Delete “Acme”?' })).toBeVisible()
})

test('only the owner is offered the deletion', () => {
  renderWith(<ChoosePlan />, noPlan(), 'admin')
  expect(screen.getByRole('link', { name: 'Workspace settings' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Delete workspace' })).toBeNull()
})

test('the picker sends a workspace on Free home', () => {
  renderWith(<ChoosePlan />, billingFixture())
  expect(replace).toHaveBeenCalledWith('/')
})

test('the picker sends a workspace with a plan home', () => {
  renderWith(<ChoosePlan />, billingFixture({ locked: false, plan: 'basic', status: 'active' }))
  expect(replace).toHaveBeenCalledWith('/')
  expect(screen.queryByRole('article', { name: 'Basic' })).toBeNull()
})

/** A page that reads billing itself, as the sidebar and the usage meters do. */
function ReadsBilling() {
  useBilling()
  return <p>The list</p>
}

test('billing the person may not read does not hold the page', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.session, session)
  server.use(
    http.get('/api/v1/billing', () =>
      HttpResponse.json({ error: { code: 'forbidden', message: 'No access.' } }, { status: 403 }),
    ),
  )
  render(
    <QueryClientProvider client={client}>
      <PlanGate>
        <ReadsBilling />
      </PlanGate>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('The list', {}, { timeout: 2000 })).toBeVisible()
  // The page's own read refetches billing; the gate must not take the page away again.
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
  expect(screen.getByText('The list')).toBeVisible()
})

test('back from a cancelled Checkout the picker says so and tidies the URL', () => {
  window.history.replaceState(null, '', '/choose-plan?checkout=canceled')
  renderWith(<ChoosePlan />, noPlan())
  expect(toast).toHaveBeenCalledWith('Checkout cancelled. Nothing was charged.')
  expect(replace).toHaveBeenCalledWith('/choose-plan')
  expect(screen.getByRole('article', { name: 'Basic' })).toBeVisible()
  window.history.replaceState(null, '', '/')
})
