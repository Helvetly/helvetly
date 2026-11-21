import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { billingFixture } from '@/components/billing/billing-fixture'

import { AccessGate } from './access-gate'

let pathname = '/clients'
const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}))

function renderGate(scopes?: string[], billing?: unknown) {
  const client = new QueryClient()
  if (billing) client.setQueryData(['billing'], billing)
  client.setQueryData(['session'], { role: 'member', scopes })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <AccessGate>
            <p>The list</p>
          </AccessGate>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('a page without read shows a friendly state instead of the page', () => {
  renderGate(['read:invoices'])
  expect(screen.queryByText('The list')).toBeNull()
  expect(screen.getByText("You don't have access to clients")).toBeVisible()
})

test('the page shows with read, with write alone and without scopes', () => {
  renderGate(['write:clients'])
  expect(screen.getByText('The list')).toBeVisible()
})

test('a session without scopes (API not updated) shows the page', () => {
  renderGate(undefined)
  expect(screen.getByText('The list')).toBeVisible()
})

test('pages without a resource are always shown', () => {
  pathname = '/settings/security'
  renderGate(['read:invoices'])
  expect(screen.getByText('The list')).toBeVisible()
  pathname = '/clients'
})

test('employment settings lead home on a plan without employees and without records, and stay with records', () => {
  const pro = billingFixture({ plan: 'pro', locked: false })
  pathname = '/settings/employment'
  renderGate(['read:employees'], pro)
  expect(screen.queryByText('The list')).toBeNull()
  expect(replace).toHaveBeenCalledWith('/')
  replace.mockClear()
  renderGate(['read:employees'], { ...pro, has_employees: true })
  expect(replace).not.toHaveBeenCalled()
  pathname = '/clients'
})

test('the employees page opens on a plan without it: it shows the plan offer itself', () => {
  pathname = '/employees'
  renderGate(['read:employees'], billingFixture({ plan: 'pro', locked: false }))
  expect(screen.getByText('The list')).toBeVisible()
  expect(replace).not.toHaveBeenCalled()
  pathname = '/clients'
})

test('employment settings show nothing, and do not redirect, while billing loads', () => {
  pathname = '/settings/employment'
  renderGate(['read:employees'])
  expect(screen.queryByText('The list')).toBeNull()
  expect(replace).not.toHaveBeenCalled()
  pathname = '/clients'
})
