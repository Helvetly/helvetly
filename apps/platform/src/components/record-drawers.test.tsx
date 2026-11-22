import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RecordDrawers } from './record-drawers'
import { RecordLink, RecordPageButton, useDrawers } from './record-link'

const pathname = vi.hoisted(() => ({ current: '/clients' }))
const push = vi.hoisted(() => vi.fn<(href: string) => void>())
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push }),
}))
vi.mock('@/components/invoices/invoice-editor', () => ({
  InvoiceEditorDrawer: ({
    compose,
    onClose,
    onCreated,
  }: {
    compose: { id: string | null; client: string | null }
    onClose: () => void
    onCreated: (id: string) => void
  }) => (
    <dialog
      open
      aria-label={compose.id ? `Draft ${compose.id}` : `New invoice ${compose.client ?? ''}`}
    >
      <button type="button" onClick={() => onCreated('inv_7')}>
        Save draft
      </button>
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </dialog>
  ),
}))
vi.mock('@/components/quotes/quote-editor', () => ({ NewQuoteSheet: () => null }))
vi.mock('@/components/expenses/expense-form', () => ({ ExpenseForm: () => null }))
vi.mock('@/components/engagements/engagement-form', () => ({ EngagementForm: () => null }))
vi.mock('@/components/products/product-form', () => ({ ProductForm: () => null }))
vi.mock('@/components/products/product-form-model', () => ({ productDefaults: () => ({}) }))
vi.mock('@/lib/invoices', () => ({ canManageInvoices: () => true, useInvoiceSettings: () => ({}) }))
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
vi.mock('@/components/clients/client-form', () => ({
  ClientForm: ({
    client,
    onSaved,
  }: {
    client?: { id: string }
    onSaved: (client: { id: string }, created: boolean) => void
  }) =>
    client ? null : (
      <dialog open aria-label="New client">
        <button type="button" onClick={() => onSaved({ id: 'cli_new' }, true)}>
          Save client
        </button>
      </dialog>
    ),
}))
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

const shown = () => screen.queryAllByRole('dialog').map((d) => d.getAttribute('aria-label'))

/** A page's own button that opens a form over it, like the dashboard's "New invoice". */
function NewInvoiceButton({ client }: { client?: string }) {
  const drawers = useDrawers()
  return (
    <button type="button" onClick={() => drawers.open({ kind: 'invoice', mode: 'new', client })}>
      New invoice
    </button>
  )
}

describe('RecordDrawers', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    push.mockClear()
  })

  it('opens New invoice over the dashboard without leaving it, and closing restores the page', async () => {
    pathname.current = '/'
    render(
      <RecordDrawers>
        <NewInvoiceButton />
      </RecordDrawers>,
    )
    await userEvent.click(screen.getByText('New invoice'))
    expect(shown()).toEqual(['New invoice '])
    expect(window.location.pathname).toBe('/')
    expect(new URLSearchParams(window.location.search).getAll('drawer')).toEqual(['invoice:new'])
    expect(push).not.toHaveBeenCalled()

    // The first save keeps the editor open on the new draft, and the address follows.
    await userEvent.click(screen.getByText('Save draft'))
    expect(shown()).toEqual(['Draft inv_7'])
    expect(window.location.search).toBe('?drawer=invoice%3Aedit%3Ainv_7')

    await userEvent.click(screen.getByText('Close editor'))
    expect(shown()).toEqual([])
    expect(window.location.pathname + window.location.search).toBe('/')
  })

  it('shows the stack in the address again after a reload', () => {
    pathname.current = '/'
    window.history.replaceState(
      null,
      '',
      '/?drawer=invoice:inv_1&drawer=client:cli_1&drawer=nope:x',
    )
    render(<RecordDrawers>page</RecordDrawers>)
    expect(shown()).toEqual(['Invoice inv_1', 'Client cli_1'])
  })

  it("leaves a form to its own page's drawer when nothing is stacked", async () => {
    pathname.current = '/invoices'
    window.history.replaceState(null, '', '/invoices?status=draft')
    render(
      <RecordDrawers>
        <NewInvoiceButton />
      </RecordDrawers>,
    )
    await userEvent.click(screen.getByText('New invoice'))
    expect(push).toHaveBeenCalledWith('/invoices?compose=new')
    expect(shown()).toEqual([])
  })

  it('opens a new invoice for a client from its drawer, and a created client in its form’s place', async () => {
    pathname.current = '/'
    render(
      <RecordDrawers>
        <RecordLink href="/clients?id=cli_1">Client</RecordLink>
        <RecordLink href="/invoices?compose=new&cclient=cli_1">Invoice for client</RecordLink>
        <RecordLink href="/clients?new=1">New client</RecordLink>
      </RecordDrawers>,
    )
    await userEvent.click(screen.getByText('Client'))
    await userEvent.click(screen.getByText('Invoice for client'))
    expect(shown()).toEqual(['Client cli_1', 'New invoice cli_1'])
    await userEvent.click(screen.getByText('Close editor'))

    await userEvent.click(screen.getByText('New client'))
    expect(shown()).toEqual(['Client cli_1', 'New client'])
    await userEvent.click(screen.getByText('Save client'))
    expect(shown()).toEqual(['Client cli_1', 'Client cli_new'])
    expect(push).not.toHaveBeenCalled()
  })

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
    window.history.pushState(null, '', '/invoices')
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
