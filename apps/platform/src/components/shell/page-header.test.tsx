import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { fitTabs, PageHeader } from './page-header'

let pathname = '/invoices'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

function renderHeader(onPrimary: () => void, scopes?: string[]) {
  const client = new QueryClient()
  client.setQueryData(['session'], { role: 'member', scopes })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <PageHeader tabs={['All']} primary="New invoice" onPrimary={onPrimary} />
          <input aria-label="Search" />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('N presses the primary button', () => {
  pathname = '/invoices'
  const onPrimary = vi.fn<() => void>()
  renderHeader(onPrimary)
  expect(screen.getByRole('button', { name: 'New invoice' })).toHaveAttribute(
    'aria-keyshortcuts',
    'N',
  )
  fireEvent.keyDown(window, { key: 'n' })
  expect(onPrimary).toHaveBeenCalledTimes(1)
})

test('N while typing or with a modifier does nothing', () => {
  pathname = '/invoices'
  const onPrimary = vi.fn<() => void>()
  renderHeader(onPrimary)
  fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'n' })
  fireEvent.keyDown(window, { key: 'n', metaKey: true })
  expect(onPrimary).not.toHaveBeenCalled()
})

test('a keydown without a key (Chrome autofill) is ignored', () => {
  pathname = '/invoices'
  const onPrimary = vi.fn<() => void>()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  renderHeader(onPrimary)
  window.dispatchEvent(new Event('keydown'))
  expect(errors).not.toHaveBeenCalled()
  expect(onPrimary).not.toHaveBeenCalled()
  errors.mockRestore()
})

test.each([
  ['/invoices', ['read:*'], false],
  ['/invoices', ['read:*', 'write:invoices'], true],
  ['/invoices', ['read:*', 'write:expenses'], false],
  ['/', ['read:*'], true],
  ['/invoices', undefined, true],
])('on %s with scopes %j the primary button shows: %s', (path, scopes, shown) => {
  pathname = path
  const onPrimary = vi.fn<() => void>()
  renderHeader(onPrimary, scopes)
  fireEvent.keyDown(window, { key: 'n' })
  expect(screen.queryByRole('button', { name: 'New invoice' }) !== null).toBe(shown)
  expect(onPrimary).toHaveBeenCalledTimes(shown ? 1 : 0)
})

test('a tab shows its count, and nothing for zero', () => {
  pathname = '/expenses'
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <PageHeader tabs={['All', 'Unpaid', 'Void']} tabCounts={[undefined, 3, 0]} />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  const nav = screen.getByRole('navigation', { name: 'Views' })
  expect(nav).toHaveTextContent('AllUnpaid3Void')
})

test('the "…" button shows only when the page has its own menu items', () => {
  pathname = '/members'
  renderHeader(vi.fn<() => void>())
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
})

test('a single tab shows no tab row, no "+" and no visible title, its controls with the actions', () => {
  pathname = '/'
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <PageHeader
            tabs={['Dashboard']}
            onSelect={() => {}}
            actions={<button type="button">This month</button>}
          />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toHaveClass('sr-only')
  expect(screen.getByRole('button', { name: 'This month' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Views' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save a view' })).not.toBeInTheDocument()
})

test('two tabs are a tab row with "+"', () => {
  pathname = '/invoices'
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <PageHeader tabs={['All', 'Drafts']} onSelect={() => {}} />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByRole('navigation', { name: 'Views' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save a view' })).toBeInTheDocument()
})

test('keepTab shows a single tab as a tab', () => {
  pathname = '/documents'
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <PageHeader tabs={['All files']} onSelect={() => {}} savedViews={false} keepTab />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByRole('button', { name: 'All files' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('heading', { name: 'All files' })).not.toBeInTheDocument()
})

test.each([
  ['all fit', [50, 60, 70], 300, 0, [0, 1, 2]],
  ['all fit with "+"', [50, 60, 70], 300, 1, [0, 1, 2]],
  ['the last ones go into "More"', [100, 100, 100, 100], 300, 0, [0, 1]],
  ['a hidden active tab swaps in', [100, 100, 100, 100], 300, 3, [0, 3]],
  ['only the active one when nothing else fits', [100, 200, 100], 160, 1, [1]],
  ['the active one even when it alone is too wide', [100, 400], 120, 1, [1]],
])('%s', (_, widths, room, active, shown) => {
  expect(fitTabs({ widths, room, more: 60, extra: 28, active })).toEqual(shown)
})

test('the room left for "+" counts only when every tab fits', () => {
  expect(fitTabs({ widths: [100, 100], room: 204, more: 60, extra: 28, active: 0 })).toEqual([0])
  expect(fitTabs({ widths: [100, 100], room: 236, more: 60, extra: 28, active: 0 })).toEqual([0, 1])
})
