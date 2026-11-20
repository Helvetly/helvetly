import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { MouseEventHandler } from 'react'
import { toast } from 'sonner'

import type { Engagement, Entry, Period } from '@/lib/engagements'
import { sendReport } from '@/lib/engagements'
import { setWorkspaceTimezone } from '@/lib/timezone'

import { EngagementDetail } from './engagement-detail'
vi.mock('@/lib/engagements', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  reportUrl: (id: string, periodId: string, download?: boolean) =>
    `/api/v1/engagements/${id}/periods/${periodId}/report${download ? '?download=1' : ''}`,
  entriesExportUrl: (id: string) => `/api/v1/engagements/${id}/entries.csv`,
  sendReport: vi.fn<typeof sendReport>(),
}))

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn<() => void>() }),
  usePathname: () => '/engagements',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn<() => void>(), {
    success: vi.fn<(message: string, options?: { action?: unknown }) => void>(),
    error: vi.fn<(message: string) => void>(),
  }),
}))
vi.mock('@/components/engagements/engagement-bits', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ProgressBar: () => <div data-testid="progress" />,
  AttentionBadges: () => null,
}))
vi.mock('@/components/engagements/engagement-form', () => ({ EngagementForm: () => null }))

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date())
const period = (change: Partial<Period> = {}): Period => ({
  id: 'epr_1',
  index: 1,
  starts_on: '2020-01-01',
  ends_on: '2099-12-31',
  quantity: '10',
  full_quantity: '10',
  unearned: '0',
  carried_in: '0',
  available: '10',
  natural_ends_on: '2099-12-31',
  unit_price: '100.00',
  overage_unit_price: '100.00',
  used: '8',
  remaining: '2',
  overage: '0',
  expected: '5',
  state: 'open',
  advance_invoice: null,
  invoiced_quantity: '0',
  uninvoiced_quantity: '8',
  invoices: [],
  ...change,
})
const engagement = (change: Partial<Engagement> = {}): Engagement => ({
  id: 'eng_1',
  number: 1,
  client: { id: 'cli_1', number: 1, name: 'Müller AG' },
  title: 'German lessons',
  description: null,
  product_id: null,
  unit: 'hour',
  quantity: '10',
  rollover: false,
  auto_invoice: false,
  invoice_detail: 'summary',
  billing: 'advance',
  price_basis: 'net',
  unit_price: '100.00',
  unit_price_net: '100.00',
  unit_price_gross: '108.10',
  overage_unit_price: null,
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  start_date: '2020-01-01',
  recurrence: 'monthly',
  interval: 1,
  end_date: null,
  reference: null,
  document_id: null,
  status: 'active',
  cancelled_on: null,
  current_period: period(),
  attention: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...change,
})
const entry = (change: Partial<Entry> = {}): Entry => ({
  id: 'ent_1',
  period_id: 'epr_1',
  date: '2026-11-01',
  quantity: '1.5',
  note: '<b>Grammar</b> & Umlaute äöü',
  client_performance: null,
  client_performance_on_invoice: false,
  performed_by: null,
  invoice: null,
  created_at: '2026-11-01T09:00:00Z',
  created_by: null,
  ...change,
})

let periods = [period()]
let entries = [entry()]
let posted: unknown = null
let deleted = ''
let invoiced: unknown = null
let current = engagement()
let undoAction: MouseEventHandler<HTMLButtonElement> | undefined
const undo = () => {
  // A real button gives the handler a real click event.
  render(<button onClick={undoAction}>Undo toast</button>)
  fireEvent.click(screen.getByRole('button', { name: 'Undo toast' }))
}
let invoiceReply: Response = HttpResponse.json(
  { data: { invoice_id: 'inv_7', period: period() } },
  { status: 201 },
)
const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({ user: { id: 'u', name: 'A' }, role: 'owner', csrf_token: 't' }),
  ),
  http.get('/api/v1/members', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/engagements/eng_1', () => HttpResponse.json({ data: current })),
  http.get('/api/v1/engagements/eng_1/periods', () => HttpResponse.json({ data: periods })),
  http.get('/api/v1/engagements/eng_1/entries', () => HttpResponse.json({ data: entries })),
  http.post('/api/v1/engagements/eng_1/entries', async ({ request }) => {
    posted = await request.json()
    return HttpResponse.json(
      { data: { entry: entry({ id: 'ent_2' }), period: period() } },
      { status: 201 },
    )
  }),
  http.delete('/api/v1/engagements/eng_1/entries/:id', ({ params }) => {
    deleted = String(params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('/api/v1/clients/cli_1', () =>
    HttpResponse.json({ data: { id: 'cli_1', billing_email: 'ap@mueller.ch', email: null } }),
  ),
  http.get('/api/v1/clients/cli_2', () =>
    HttpResponse.json({ data: { id: 'cli_2', billing_email: null, email: null } }),
  ),
  http.post('/api/v1/engagements/eng_1/periods/epr_1/invoice', async ({ request }) => {
    invoiced = await request.json()
    return invoiceReply.clone()
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  periods = [period()]
  entries = [entry()]
  posted = null
  deleted = ''
  invoiced = null
  current = engagement()
  push.mockClear()
  vi.mocked(toast.success)
    .mockReset()
    .mockImplementation((_message, options) => {
      const action = options?.action
      if (typeof action === 'object' && action !== null && 'onClick' in action)
        undoAction = action.onClick
      return 1
    })
  vi.mocked(toast.error).mockClear()
})
afterEach(() => server.resetHandlers())

function open() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <EngagementDetail id="eng_1" onOpenChange={() => {}} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('quick log', () => {
  it('defaults to today in the workspace zone, not Zurich', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-07T20:00:00Z') })
    setWorkspaceTimezone('Pacific/Auckland')
    try {
      const user = userEvent.setup()
      open()
      await user.type(await screen.findByLabelText('Quantity'), '1{Enter}')
      await waitFor(() => expect(posted).toMatchObject({ date: '2026-11-08' }))
    } finally {
      vi.useRealTimers()
      setWorkspaceTimezone('Europe/Zurich')
    }
  })

  it('Enter logs, focus returns to quantity, Undo deletes', async () => {
    const user = userEvent.setup()
    open()
    const quantity = await screen.findByLabelText('Quantity')
    await user.type(quantity, '1,5{Enter}')
    await waitFor(() => expect(posted).toMatchObject({ date: today, quantity: '1.5' }))
    await waitFor(() => expect(quantity).toHaveFocus())
    undo()
    await waitFor(() => expect(deleted).toBe('ent_2'))
  })

  it('warns about overage but still saves', async () => {
    const user = userEvent.setup()
    open()
    await user.type(await screen.findByLabelText('Quantity'), '5')
    expect(screen.getByRole('status')).toHaveTextContent('3 over')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(posted).toMatchObject({ quantity: '5' }))
  })
})

describe('entries', () => {
  it('locks an invoiced entry, links the invoice, and shows notes as text', async () => {
    entries = [
      entry({ invoice: { id: 'inv_3', number: '2026-003', status: 'open', kind: 'usage' } }),
    ]
    open()
    const link = await screen.findByRole('link', { name: /2026-003/ })
    expect(link).toHaveAttribute('href', '/invoices?id=inv_3')
    expect(screen.queryByLabelText('Edit entry')).toBeNull()
    expect(screen.queryByLabelText('Delete entry')).toBeNull()
    expect(screen.getByText(/<b>Grammar<\/b> & Umlaute äöü/)).toBeInTheDocument()
  })
})

describe('entries panel', () => {
  it('groups entries by period with a count and total', async () => {
    entries = [
      entry({ client_performance: 'On time', client_performance_on_invoice: true }),
      entry({ id: 'ent_2', quantity: '2.25', note: null }),
    ]
    open()
    const group = await screen.findByRole('region', { name: '1. Jan 2020 – 31. Dec 2099' })
    expect(group).toHaveTextContent('2 entries · 3.75 h')
    expect(group).toHaveTextContent('No note')
    expect(group).toHaveTextContent('Client performance: On time')
    expect(within(group).getByText('on invoice')).toBeInTheDocument()
  })

  it('says when nothing is logged and offers no export', async () => {
    entries = []
    open()
    expect(await screen.findByText(/Nothing logged yet\./)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Export CSV' })).toBeNull()
  })
})

describe('current period', () => {
  it('rounds the expected use and shows what is left with the unit', async () => {
    current = engagement({ current_period: period({ expected: '0.652', remaining: '2' }) })
    open()
    expect(await screen.findByText('Expected by now')).toBeInTheDocument()
    expect(screen.getByText('0.7 h')).toBeInTheDocument()
    expect(screen.getByText('Left').nextElementSibling).toHaveTextContent('2 h')
  })
})

describe('invoicing', () => {
  it('disables the upfront invoice once linked', async () => {
    periods = [
      period({ advance_invoice: { id: 'inv_1', number: null, status: 'draft', kind: 'advance' } }),
    ]
    const user = userEvent.setup()
    open()
    await screen.findByLabelText('Quantity')
    expect(screen.queryByRole('button', { name: 'Invoice upfront' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Period actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Invoiced upfront' })).toHaveAttribute(
      'data-disabled',
    )
  })

  it('offers usage as the next action once upfront is invoiced', async () => {
    periods = [
      period({ advance_invoice: { id: 'inv_1', number: null, status: 'draft', kind: 'advance' } }),
    ]
    const user = userEvent.setup()
    open()
    const button = await screen.findByRole('button', { name: 'Invoice usage' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await waitFor(() => expect(invoiced).toMatchObject({ kind: 'usage', detail: 'summary' }))
  })

  it('opens the new draft', async () => {
    const user = userEvent.setup()
    open()
    const button = await screen.findByRole('button', { name: 'Invoice upfront' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/invoices/edit?id=inv_7'))
  })

  it('explains a refusal in plain words', async () => {
    invoiceReply = HttpResponse.json(
      { error: { code: 'already_invoiced', message: 'conflict' } },
      { status: 409 },
    )
    const user = userEvent.setup()
    open()
    const button = await screen.findByRole('button', { name: 'Invoice upfront' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This period already has an upfront invoice.'),
    )
  })
})

describe('v2 periods', () => {
  it('shows rollover and proration', async () => {
    periods = [period({ carried_in: '3', available: '13', quantity: '10', full_quantity: '30' })]
    current = engagement({ current_period: periods[0] })
    open()
    expect((await screen.findAllByText(/\+3 h carried over/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/prorated from 30 h/).length).toBeGreaterThan(0)
  })

  it('hints a credit note for unearned upfront hours', async () => {
    periods = [
      period({
        unearned: '4.5',
        advance_invoice: { id: 'inv_1', number: '2026-001', status: 'open', kind: 'advance' },
      }),
    ]
    open()
    const link = await screen.findByRole('link', { name: 'Issue a credit note?' })
    expect(link).toHaveAttribute('href', '/invoices?id=inv_1')
    expect(link.parentElement).toHaveTextContent('4.5 h were invoiced upfront but not delivered.')
  })

  it('marks automatic drafts and invoices usage with the engagement default', async () => {
    current = engagement({ auto_invoice: true, invoice_detail: 'per_entry' })
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('Drafts automatic')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Period actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Invoice usage' }))
    await waitFor(() => expect(invoiced).toMatchObject({ kind: 'usage', detail: 'per_entry' }))
  })

  it('links the CSV export', async () => {
    open()
    expect(await screen.findByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/v1/engagements/eng_1/entries.csv',
    )
  })
})

describe('service report', () => {
  it('Download opens the PDF', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Period actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Download report' }))
    expect(opened).toHaveBeenCalledWith(
      '/api/v1/engagements/eng_1/periods/epr_1/report?download=1',
      '_blank',
    )
    opened.mockRestore()
  })

  it('Send prefills the billing email, posts and toasts the recipients', async () => {
    vi.mocked(sendReport).mockResolvedValue({ to: ['ap@mueller.ch'] })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Period actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Send report…' }))
    const to = await screen.findByLabelText(/^To/)
    await waitFor(() => expect(to).toHaveValue('ap@mueller.ch'))
    expect(screen.getByLabelText('Subject')).toHaveValue(
      'Service report – German lessons – 1. Jan 2020 – 31. Dec 2099',
    )
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(sendReport).toHaveBeenCalledWith(
        'eng_1',
        'epr_1',
        expect.objectContaining({ to: ['ap@mueller.ch'] }),
      ),
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Service report sent to ap@mueller.ch.'),
    )
  })

  it('refuses an empty recipient', async () => {
    current = engagement({ client: { id: 'cli_2', number: 2, name: 'Other' } })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Period actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Send report…' }))
    await user.click(await screen.findByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Add at least one email address.')).toBeInTheDocument()
  })
})

it('Renew cannot be chosen again while the first renewal is running', async () => {
  current = engagement({ recurrence: 'none' })
  let renewals = 0
  server.use(
    http.post('/api/v1/engagements/eng_1/renew', async () => {
      renewals += 1
      await new Promise(() => {}) // never answers: the renewal stays pending
    }),
  )
  const user = userEvent.setup()
  open()
  await user.click(await screen.findByRole('button', { name: 'More actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Renew' }))
  await waitFor(() => expect(renewals).toBe(1))
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  expect(await screen.findByRole('menuitem', { name: 'Renew' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})
