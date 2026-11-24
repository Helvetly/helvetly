import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type * as Permissions from '@/lib/permissions'

import { MobileTabBar } from './mobile-tab-bar'
import { PageHeader } from './page-header'
import { PrimaryActionProvider } from './primary-action'

const push = vi.fn<(href: string) => void>()
const prefetch = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, prefetch }),
  usePathname: () => '/invoices/new',
}))

let scopes: string[] = ['*:*']
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof Permissions>()),
  useScopes: () => scopes,
}))

const renderBar = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <MobileTabBar />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

test('shows Home, Invoices, Clients and Menu, with the current page marked', () => {
  scopes = ['*:*']
  renderBar()
  const nav = screen.getByRole('navigation', { name: 'Main' })
  expect((nav.textContent ?? '').replace(/\s+/g, ' ')).toMatch(/Home.*Invoices.*Clients.*Menu/)
  expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
})

test('a page this person cannot read has no tab', () => {
  scopes = ['read:clients']
  renderBar()
  expect(screen.queryByRole('link', { name: 'Invoices' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Clients' })).toBeVisible()
})

test('"+" lists only what this person may create and opens it', async () => {
  scopes = ['read:*', 'write:expenses']
  renderBar()
  await userEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(screen.queryByRole('button', { name: 'New invoice' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'New expense' }))
  expect(push).toHaveBeenCalledWith('/expenses?new=1')
})

test('"+" is the open page\'s primary action', async () => {
  scopes = ['*:*']
  const create = vi.fn<() => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <PrimaryActionProvider>
            <PageHeader tabs={['All']} primary="New invoice" onPrimary={create} />
            <MobileTabBar />
          </PrimaryActionProvider>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  const bar = screen.getByRole('navigation', { name: 'Main' })
  await userEvent.click(within(bar).getByRole('button', { name: 'New invoice' }))
  expect(create).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a tapped tab is current at once, before its page has loaded', async () => {
  scopes = ['*:*']
  renderBar()
  const clients = screen.getByRole('link', { name: 'Clients' })
  clients.addEventListener('click', (event) => event.preventDefault())
  await userEvent.hover(clients)
  expect(prefetch).toHaveBeenCalledWith('/clients')
  await userEvent.click(clients)
  expect(clients).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Invoices' })).not.toHaveAttribute('aria-current')
})
