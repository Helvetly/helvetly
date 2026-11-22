import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { billingFixture } from '@/components/billing/billing-fixture'
import { editorApi, listItem, sampleInvoice, sampleSummary } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { bulkActions, datePresets, InvoicesPage } from './invoices-page'

// The list keeps its state in the URL through the History API (lib/url-query); the URL it sets is
// the last call's third argument.
const replace = vi.spyOn(window.history, 'replaceState')
const lastUrl = () => replace.mock.lastCall?.[2]
const push = vi.fn<(href: string) => void>()
let search = new URLSearchParams()
let pathname = '/invoices'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}))

const clients = [
  sampleClient(),
  sampleClient({ id: 'cli_2', number: 2, name: 'Keller Holzbau AG' }),
  sampleClient({ id: 'cli_3', number: 3, name: 'Meier & Partner' }),
]
const invoices = [
  sampleInvoice({ id: 'inv_1', status: 'draft' }),
  sampleInvoice({
    id: 'inv_2',
    number: '2026-002',
    status: 'open',
    is_overdue: true,
    client: { id: 'cli_2', number: 2, name: 'Keller Holzbau AG' },
  }),
  sampleInvoice({ id: 'inv_3', number: '2026-003', status: 'open', amount_due: '1000.00' }),
  sampleInvoice({ id: 'inv_4', kind: 'credit_note', number: 'CN-2026-001', status: 'paid' }),
]
const server = setupServer(
  // Business: every invoice feature is on, so no plan tag or lock shows.
  http.get('/api/v1/billing', () =>
    HttpResponse.json({
      data: billingFixture({ plan: 'business', status: 'active', locked: false }),
    }),
  ),
  // Nothing waits for this person's approval.
  http.get('/api/v1/approvals/inbox', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/session', () =>
    HttpResponse.json({ user: { id: 'usr_1', name: 'Anna' }, role: 'member', csrf_token: 't' }),
  ),
  http.get('/api/v1/clients', () =>
    HttpResponse.json({
      data: clients,
      meta: { page: 1, page_size: 12, total: 3, total_pages: 1 },
    }),
  ),
  http.get<{ id: string }>('/api/v1/clients/:id', ({ params }) => {
    const client = clients.find((entry) => entry.id === params.id)
    return client ? HttpResponse.json({ data: client }) : new HttpResponse(null, { status: 404 })
  }),
  http.get('/api/v1/invoices/summary', () => HttpResponse.json({ data: sampleSummary })),
  http.get('/api/v1/invoices', () =>
    HttpResponse.json({
      data: invoices.map(listItem),
      meta: { page: 1, page_size: 50, total: invoices.length, total_pages: 1 },
    }),
  ),
  ...editorApi(clients),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  search = new URLSearchParams()
  pathname = '/invoices'
  replace.mockClear()
  push.mockClear()
})
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider>
          <InvoicesPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

test('the tabs are the eight document types, and the URL picks the tab', async () => {
  search = new URLSearchParams('kind=proforma')
  server.use(
    http.get('/api/v1/invoices', () =>
      HttpResponse.json({ data: [], meta: { page: 1, page_size: 50, total: 0, total_pages: 0 } }),
    ),
  )
  renderPage()
  const tabs = within(screen.getByRole('navigation', { name: 'Views' })).getAllByRole('button')
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Invoices',
    'Partial invoices',
    'Prepayments',
    'Debit notes',
    'Corrections',
    'Credit notes',
    'Proforma',
    'Self-billed',
  ])
  expect(screen.getByRole('button', { name: 'Proforma' })).toHaveAttribute('aria-current', 'page')
  await screen.findByText('No proforma yet')
  expect(screen.queryByText('Outstanding')).not.toBeInTheDocument()
})

test('switching tabs changes only the type and keeps the filters', async () => {
  search = new URLSearchParams('status=open&client=cli_2')
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'Proforma' }))
  expect(lastUrl()).toBe('/invoices?status=open&kind=proforma&client=cli_2')
  await userEvent.click(screen.getByRole('button', { name: 'Invoices' }))
  expect(lastUrl()).toBe('/invoices?status=open&client=cli_2')
})

test('status is filtered in the Filters popover, Replaced included', async () => {
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: /Filters/ }))
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Replaced' }))
  expect(lastUrl()).toBe('/invoices?status=replaced')
})

test('New invoice makes an invoice; its menu makes the other types', async () => {
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'New invoice' }))
  expect(lastUrl()).toBe('/invoices?compose=new')

  await userEvent.click(screen.getByRole('button', { name: 'New invoice options' }))
  // Made from an issued invoice: always offered, the picker that follows asks which one.
  expect(screen.getByRole('menuitem', { name: /Credit note/ })).not.toHaveAttribute('aria-disabled')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Prepayment invoice' }))
  expect(lastUrl()).toBe('/invoices?compose=new&ckind=prepayment')
})

test('the KPI band shows on receivable tabs only', async () => {
  renderPage()
  expect(await screen.findByText('Outstanding')).toBeInTheDocument()
})

test('no KPI band on the credit notes tab, and only credit notes show negative', async () => {
  search = new URLSearchParams('kind=credit_note')
  renderPage()
  const table = await screen.findByRole('table')
  expect(screen.queryByText('Outstanding')).not.toBeInTheDocument()
  // Narrow columns are left out below their width, so find the amount column by its header.
  const column = within(table)
    .getAllByRole('columnheader')
    .findIndex((header) => header.textContent === 'Amount')
  expect(column).toBeGreaterThan(0)
  const amounts = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td')[column]?.textContent ?? '')
  expect(amounts.filter((amount) => amount.includes('−'))).toHaveLength(1)
})

test('date presets are whole calendar ranges', () => {
  const presets = datePresets('2026-11-05')
  expect(presets.find((preset) => preset.label === 'Last month')).toEqual({
    label: 'Last month',
    from: '2026-10-01',
    to: '2026-10-31',
  })
  expect(presets.find((preset) => preset.label === 'This quarter')?.from).toBe('2026-10-01')
})

test('bulk delete is offered only for drafts in the selection', () => {
  const run = {
    exportCsv: vi.fn<() => void>(),
    downloadPdfs: vi.fn<() => void>(),
    removeDrafts: vi.fn<() => void>(),
  }
  expect(bulkActions(0, run).map((action) => action.label)).toEqual(['Export CSV', 'Download PDFs'])
  expect(bulkActions(2, run).at(-1)?.label).toBe('Delete 2 drafts')
})

test('lists invoices from the API; sorting goes to the URL', async () => {
  renderPage()
  const table = await screen.findByRole('table')
  expect(within(table).getAllByText('Keller Holzbau AG').length).toBeGreaterThan(0)
  expect(within(table).getAllByText('Overdue').length).toBeGreaterThan(0)
  expect(within(table).getByText('CN-2026-001')).toBeInTheDocument()

  await userEvent.click(within(table).getByRole('button', { name: /Amount/ }))
  expect(lastUrl()).toBe('/invoices?sort=-total')
})

test('a member sees no Void in a row’s menu', async () => {
  search = new URLSearchParams('status=open&kind=invoice')
  renderPage()
  const table = await screen.findByRole('table')
  await userEvent.click(within(table).getByRole('button', { name: /^Actions for 2026-002/ }))
  expect(await screen.findByRole('menuitem', { name: /Record payment/ })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: /Void/ })).not.toBeInTheDocument()
})

const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())

test('right-clicking a row offers what its state allows, and acts on it', async () => {
  renderPage()
  const table = await screen.findByRole('table')
  const [, draft, open] = within(table).getAllByRole('row')
  if (!draft || !open) throw new Error('Expected invoice rows')

  fireEvent.contextMenu(draft)
  let menu = await screen.findByRole('menu')
  expect(within(menu).getByText(/^Draft · /)).toBeInTheDocument()
  expect(menuItems()).toEqual([
    'Open details',
    'Edit draft',
    'Issue',
    'Download PDF',
    'Duplicate',
    'Delete draft',
  ])
  await userEvent.keyboard('{Escape}')

  fireEvent.contextMenu(open)
  menu = await screen.findByRole('menu')
  expect(within(menu).getByText('2026-002 · Keller Holzbau AG')).toBeInTheDocument()
  expect(menuItems()).toContain('Record payment')
  expect(menuItems()).not.toContain('Edit draft')
  await userEvent.click(screen.getByRole('menuitem', { name: /Open details/ }))
  expect(lastUrl()).toBe('/invoices?id=inv_2')
  // Right-click selects nothing.
  expect(screen.queryByRole('toolbar', { name: 'Selected rows' })).not.toBeInTheDocument()
})

test('right-clicking a selected row acts on the whole selection', async () => {
  renderPage()
  const table = await screen.findByRole('table')
  await userEvent.click(within(table).getByRole('checkbox', { name: /^Select draft for/ }))
  await userEvent.click(within(table).getByRole('checkbox', { name: /^Select 2026-002/ }))

  fireEvent.contextMenu(within(table).getByRole('checkbox', { name: /^Select 2026-002/ }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('2 selected')).toBeInTheDocument()
  expect(menuItems()).toEqual(['Export CSV', 'Download PDFs', 'Delete draft'])
})

test('right-clicking the page outside the rows offers the page’s actions', async () => {
  renderPage()
  await screen.findByRole('table')
  fireEvent.contextMenu(screen.getByRole('navigation', { name: 'Pages' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('Invoices')).toBeInTheDocument()
  expect(menuItems()).toEqual([
    'New invoice',
    'Import',
    'Export CSV',
    'Invoice settings',
    'Select all',
    'View',
    'Refresh',
  ])
  await userEvent.click(screen.getByRole('menuitem', { name: 'Select all' }))
  expect(await screen.findByRole('toolbar', { name: 'Selected rows' })).toHaveTextContent(
    'Selected: 4',
  )

  // The search box keeps the browser's menu.
  await userEvent.click(screen.getByRole('button', { name: 'Search invoices' }))
  const searchBox = screen.getByRole('searchbox', { name: 'Search invoices' })
  expect(fireEvent.contextMenu(searchBox)).toBe(true)
})

test.each([
  ['?compose=new', '/invoices'],
  ['?client=cli_1', '/invoices/new'],
])('a direct link (%s on %s) shows the list with the editor drawer open', async (query, path) => {
  search = new URLSearchParams(query)
  pathname = path
  renderPage()
  const drawer = await screen.findByRole('dialog', { name: 'New invoice' })
  expect(await within(drawer).findByLabelText('Line 1 description')).toBeInTheDocument()
  // The list is still there behind it, and the older URL's query is not read as list filters.
  expect(screen.getByRole('button', { name: 'Invoices', hidden: true })).toBeInTheDocument()
})

test('closing the editor drawer goes back to the plain list URL', async () => {
  search = new URLSearchParams('compose=new&status=open')
  renderPage()
  const drawer = await screen.findByRole('dialog', { name: 'New invoice' })
  await within(drawer).findByLabelText('Line 1 description')
  await userEvent.click(within(drawer).getByRole('button', { name: 'Close editor' }))
  expect(lastUrl()).toBe('/invoices?status=open')
})
