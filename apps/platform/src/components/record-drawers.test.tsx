import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RecordDrawers } from './record-drawers'
import { RecordLink, RecordPageButton } from './record-link'

const pathname = vi.hoisted(() => ({ current: '/clients' }))
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn<() => void>() }),
}))
vi.mock('@/components/invoices/invoice-detail', () => ({
  InvoiceDetail: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <dialog open aria-label={`Invoice ${id}`}>
      <RecordLink href="/clients?id=cli_1">Billed to</RecordLink>
      <button type="button" onClick={onClose}>
        Close invoice
      </button>
    </dialog>
  ),
}))
vi.mock('@/components/quotes/quote-detail', () => ({
  QuoteDetail: ({ id }: { id: string }) => (
    <dialog open aria-label={`Quote ${id}`}>
      <RecordLink href="/invoices?id=inv_9">From quote</RecordLink>
    </dialog>
  ),
}))
vi.mock('@/components/clients/client-detail', () => ({
  ClientDetail: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <dialog open aria-label={`Client ${id}`}>
      <button type="button" onClick={onClose}>
        Close client
      </button>
    </dialog>
  ),
}))
vi.mock('@/components/invoices/invoice-commands', () => ({
  useInvoiceCommands: () => ({ run: vi.fn<() => void>(), busy: false, dialogs: null }),
}))
vi.mock('@/lib/queries', () => ({ useSession: () => ({ data: { role: 'owner' } }) }))
vi.mock('@/lib/permissions', () => ({ useCan: () => true }))
vi.mock('@/components/clients/client-form', () => ({ ClientForm: () => null }))
vi.mock('@/components/signatures/request-drawer', () => ({
  RequestDrawer: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <dialog open aria-label={`Signature ${id}`}>
      <RecordPageButton />
      <button type="button" onClick={onClose}>
        Close signature
      </button>
    </dialog>
  ),
}))
vi.mock('@/components/documents/preview', () => ({ Preview: () => null }))
vi.mock('@/components/expenses/expense-detail', () => ({ ExpenseDetail: () => null }))
vi.mock('@/lib/expenses', () => ({
  canManageExpenses: () => true,
  expensesApi: {},
  useBulkExpenses: () => ({ mutate: vi.fn<() => void>() }),
  useExpenseAction: () => ({ mutate: vi.fn<() => void>() }),
}))
vi.mock('@/components/engagements/engagement-detail', () => ({ EngagementDetail: () => null }))
vi.mock('@/lib/clients', () => ({
  canDeleteClients: () => true,
  useSaveClient: () => ({ mutate: vi.fn<() => void>() }),
  useDeleteClient: () => ({ mutate: vi.fn<() => void>() }),
}))

describe('RecordDrawers', () => {
  it('stacks records opened from a drawer and uncovers the one below when the top one closes', async () => {
    const { rerender } = render(
      <RecordDrawers>
        <RecordLink href="/invoices?id=inv_1">Invoice</RecordLink>
      </RecordDrawers>,
    )
    await userEvent.click(screen.getByText('Invoice'))
    await userEvent.click(screen.getByText('Billed to'))
    expect(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-label'))).toEqual([
      'Invoice inv_1',
      'Client cli_1',
    ])

    await userEvent.click(screen.getByText('Close client'))
    expect(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-label'))).toEqual([
      'Invoice inv_1',
    ])

    pathname.current = '/invoices'
    rerender(
      <RecordDrawers>
        <RecordLink href="/invoices?id=inv_1">Invoice</RecordLink>
      </RecordDrawers>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a quote in place and the invoice made from it on top', async () => {
    pathname.current = '/clients'
    render(
      <RecordDrawers>
        <RecordLink href="/quotes?id=quo_1">Quote</RecordLink>
      </RecordDrawers>,
    )
    await userEvent.click(screen.getByText('Quote'))
    await userEvent.click(screen.getByText('From quote'))
    expect(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-label'))).toEqual([
      'Quote quo_1',
      'Invoice inv_9',
    ])
  })

  it('opens a signature request in place, with a link to its full page that closes the stack', async () => {
    pathname.current = '/notifications'
    render(
      <TooltipProvider>
        <RecordDrawers>
          <RecordLink href="/documents?view=signatures&request=sig_1">
            Signed by everyone
          </RecordLink>
          <RecordPageButton />
        </RecordDrawers>
      </TooltipProvider>,
    )
    // Outside a stacked drawer (on the record's own page) there is no full-page button.
    expect(screen.queryByRole('link', { name: 'Open full page' })).toBeNull()
    await userEvent.click(screen.getByText('Signed by everyone'))
    const drawer = screen.getByRole('dialog', { name: 'Signature sig_1' })
    const page = within(drawer).getByRole('link', { name: 'Open full page' })
    expect(page).toHaveAttribute('href', '/documents?view=signatures&request=sig_1')
    page.addEventListener('click', (event) => event.preventDefault())
    await userEvent.click(page)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
