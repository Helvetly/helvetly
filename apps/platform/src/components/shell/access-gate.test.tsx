import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { AccessGate } from './access-gate'

let pathname = '/clients'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

function renderGate(scopes?: string[]) {
  const client = new QueryClient()
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
