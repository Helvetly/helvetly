import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'

import { einvoiceBlock, type Invoice } from '@/lib/invoices'
import { instalmentPlans } from '@/mocks/data'
import { sampleInvoice as baseInvoice, sampleSchedule } from '@/test/invoice-api'

import { useInvoiceCommands } from './invoice-commands'
import { InvoiceDetail, moneyMovements } from './invoice-detail'
import { InvoicesPage } from './invoices-page'

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn<() => void>() }),
  usePathname: () => '/invoices',
  useSearchParams: () => new URLSearchParams('id=inv_9'),
}))

// The document-type fields every invoice carries.
const sampleInvoice = (change: Partial<Invoice> = {}) =>
  baseInvoice({
    type_code: '380',
    prepaid_total: '0.00',
    prepayments: [],
    deducted_on: null,
    ...change,
  })

const issued = (id: string, change: Partial<Invoice> = {}) =>
  sampleInvoice({
    id,
    number: '2026-010',
    status: 'open',
    issued_at: '2026-11-05T10:00:00Z',
    ...change,
  })
const documents: Record<string, Invoice> = {
  inv_open: issued('inv_open', { sent_at: '2026-11-05T11:00:00Z' }),
  inv_ro: issued('inv_ro', {
    buyer: {
      name: 'Client SRL',
      street: 'Strada Memorandumului',
      street_number: '28',
      apt: null,
      zip: '400114',
      city: 'Cluj-Napoca',
      country: 'RO',
      region: 'RO-CJ',
      vat_number: 'RO14399840',
      email: null,
    },
  }),
  inv_pf: issued('inv_pf', { kind: 'proforma', type_code: '325', number: 'PF-2026-001' }),
  inv_rep: issued('inv_rep', { status: 'replaced', amount_due: '0.00' }),
  inv_dn: issued('inv_dn', {
    kind: 'debit_note',
    type_code: '383',
    credited_invoice: { id: 'inv_open', number: '2026-010' },
  }),
  inv_sched: issued('inv_sched', {
    payable_total: '1081.00',
    amount_paid: '500.00',
    amount_due: '581.00',
    payment: {
      iban: 'CH4431999123000889012',
      reference_type: 'QRR',
      reference: '210000000003139471430009017',
      qr_bill: true,
      revolut_url: null,
    },
    instalments: {
      interval: 'monthly',
      items: sampleSchedule().items.map((item, i) =>
        Object.assign(
          item,
          { reference: `21000000000313947143000901${i + 1}` },
          i === 0 ? { paid: '360.35', open: '0.00', status: 'paid' as const } : {},
          i === 1 ? { paid: '139.65', open: '220.70', status: 'part_paid' as const } : {},
        ),
      ),
    },
  }),
  inv_source: sampleInvoice({ id: 'inv_source', plan: { id: 'pln_mock_1', seq: 0, count: 6 } }),
  inv_final: issued('inv_final', {
    prepaid_total: '1000.00',
    prepayments: [{ id: 'inv_p1', number: '2026-003', payable_total: '1000.00' }],
  }),
}
let corrected: string | null = null
let reminders: unknown = null

const by = { id: 'usr_1', name: 'Anna' }
// Paid in full, then fully credited: the customer is owed the payment back.
const credited = sampleInvoice({
  id: 'inv_9',
  number: '2026-009',
  status: 'void',
  payable_total: '1000.00',
  total: '1000.00',
  amount_paid: '1000.00',
  amount_credited: '1000.00',
  amount_due: '0.00',
  refund_due: '1000.00',
  payments: [
    {
      id: 'pay_1',
      amount: '1000.00',
      paid_on: '2026-11-01',
      method: 'bank_transfer',
      note: null,
      created_at: '2026-11-01T09:00:00Z',
      created_by: by,
    },
  ],
})
let recorded: unknown = null
const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({ user: by, role: 'owner', csrf_token: 't' }),
  ),
  http.get('/api/v1/invoices/summary', () => new HttpResponse(null, { status: 404 })),
  http.get('/api/v1/invoices', () =>
    HttpResponse.json({ data: [], meta: { page: 1, page_size: 50, total: 0, total_pages: 0 } }),
  ),
  http.get('/api/v1/invoices/inv_9', () => HttpResponse.json({ data: credited })),
  http.get('/api/v1/invoices/:id/deliveries', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/invoices/:id/dunning', () =>
    HttpResponse.json({
      data: {
        applies: true,
        enabled: false,
        client_enabled: true,
        paused: false,
        next: null,
        notices: [],
      },
    }),
  ),
  http.get('/api/v1/instalment-plans/:id', () => HttpResponse.json({ data: instalmentPlans[0] })),
  http.patch<{ id: string }>('/api/v1/invoices/:id', async ({ params, request }) => {
    reminders = await request.json()
    const found = documents[params.id]
    return found
      ? HttpResponse.json({ data: { ...found, reminders_enabled: false } })
      : new HttpResponse(null, { status: 404 })
  }),
  http.get<{ id: string }>('/api/v1/invoices/:id', ({ params }) => {
    const found = documents[params.id]
    return found ? HttpResponse.json({ data: found }) : new HttpResponse(null, { status: 404 })
  }),
  http.post<{ id: string }>('/api/v1/invoices/:id/correct', ({ params }) => {
    corrected = params.id
    return HttpResponse.json(
      { data: sampleInvoice({ id: 'inv_corr', kind: 'corrected', type_code: '384' }) },
      { status: 201 },
    )
  }),
  http.post('/api/v1/invoices/inv_9/refunds', async ({ request }) => {
    recorded = await request.json()
    return HttpResponse.json(
      { data: { ...credited, refund_due: '0.00', amount_refunded: '1000.00' } },
      { status: 201 },
    )
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

test('payments and refunds read as one history, oldest first', () => {
  const rows = moneyMovements({
    payments: credited.payments,
    refunds: [
      {
        id: 'rfd_1',
        amount: '1000.00',
        refunded_on: '2026-11-03',
        method: 'twint',
        note: null,
        created_at: '2026-11-03T10:00:00Z',
        created_by: null,
      },
    ],
  })
  expect(rows.map((row) => `${row.kind}:${row.on}`)).toEqual([
    'payment:2026-11-01',
    'refund:2026-11-03',
  ])
})

test('a refund due is called out in the drawer and recorded from there', async () => {
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
  expect(await screen.findByText('Refund due CHF 1’000.00')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Record refund' }))
  const dialog = await screen.findByRole('dialog', { name: 'Record a refund' })
  expect(within(dialog).getByRole('textbox', { name: /Amount/ })).toHaveValue('1000.00')
  await userEvent.click(within(dialog).getByRole('radio', { name: 'TWINT' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Record refund' }))
  await waitFor(() => expect(recorded).toMatchObject({ amount: '1000.00', method: 'twint' }))
})

function Detail({ id }: { id: string }) {
  const commands = useInvoiceCommands(() => {})
  return (
    <>
      <InvoiceDetail id={id} canManage onClose={() => {}} run={commands.run} busy={commands.busy} />
      {commands.dialogs}
    </>
  )
}

const renderDetail = (id: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Detail id={id} />
    </QueryClientProvider>,
  )

const menuItems = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  return (await screen.findAllByRole('menuitem')).map((item) => item.textContent?.trim())
}

test('an open proforma converts to an invoice or a prepayment and takes no payments', async () => {
  renderDetail('inv_pf')
  expect(await screen.findByText('Proforma invoice')).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /Payments/ })).not.toBeInTheDocument()
  const items = await menuItems()
  expect(items).toEqual(expect.arrayContaining(['Convert to invoice', 'Convert to prepayment']))
  expect(items).not.toContain('Record payment')
  expect(items).not.toContain('Correct')
  expect(items).toContain('Void')
})

test('Correct calls /correct and opens the new draft in the editor', async () => {
  renderDetail('inv_open')
  const items = await menuItems()
  expect(items).toEqual(expect.arrayContaining(['Correct', 'Debit note', 'Create credit note']))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Correct' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create correction' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/invoices/edit?id=inv_corr'))
  expect(corrected).toBe('inv_open')
})

test('a replaced invoice shows its status and offers no correction', async () => {
  renderDetail('inv_rep')
  // The badge and the timeline's last step.
  expect(await screen.findAllByText('Replaced')).toHaveLength(2)
  expect(await menuItems()).not.toContain('Correct')
})

test('a debit note names the invoice it adds to', async () => {
  renderDetail('inv_dn')
  expect(await screen.findByText('Debit note')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '2026-010' })).toHaveAttribute(
    'href',
    '/invoices?id=inv_open',
  )
  expect(screen.getByText(/adds to/)).toBeInTheDocument()
})

test('a final invoice lists the prepayments it deducts', async () => {
  renderDetail('inv_final')
  expect(await screen.findByText('Prepayment 2026-003')).toBeInTheDocument()
  expect(screen.getByText('−CHF 1’000.00')).toBeInTheDocument()
})

test('schedule shows part_paid', async () => {
  renderDetail('inv_sched')
  const table = await screen.findByRole('region', { name: 'Instalments' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getAllByRole('cell').at(-1)?.textContent)).toEqual([
    'Paid',
    'Part paid',
    'Open',
  ])
  expect(within(rows[1] ?? table).getByText('CHF 220.70')).toBeInTheDocument()
  expect(within(table).getByText('One QR bill per instalment')).toBeInTheDocument()
  // Issued invoices keep the reminders switch, saved alone.
  await userEvent.click(screen.getByRole('switch', { name: 'Payment reminders' }))
  await waitFor(() => expect(reminders).toEqual({ reminders_enabled: false }))
})

const openXml = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'E-invoice XML' }))
}

test('xml menu offers three formats', async () => {
  renderDetail('inv_open')
  await openXml()
  for (const name of ['XRechnung (UBL)', 'XRechnung (CII)', 'Peppol BIS 3.0'])
    expect(screen.getByRole('menuitem', { name })).toBeEnabled()
  expect(screen.queryByRole('menuitem', { name: /e-Factura/ })).not.toBeInTheDocument()
})

test('a Romanian buyer also gets the e-Factura with where to upload it', async () => {
  renderDetail('inv_ro')
  await openXml()
  expect(
    screen.getByRole('menuitem', { name: /e-Factura \(CIUS-RO\).*Spațiul Privat Virtual/ }),
  ).toBeEnabled()
})

test('XML export failure explains the missing data without downloading JSON', async () => {
  const message = 'Peppol XML requires verified seller and buyer electronic endpoint identifiers.'
  const errorToast = vi.spyOn(toast, 'error')
  server.use(
    http.get('/api/v1/invoices/inv_open/einvoice', () =>
      HttpResponse.json(
        {
          error: { code: 'einvoice_endpoint_missing', message, details: {} },
        },
        { status: 409 },
      ),
    ),
  )
  try {
    renderDetail('inv_open')
    await openXml()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Peppol BIS 3.0' }))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(message))
  } finally {
    errorToast.mockRestore()
    server.resetHandlers()
  }
})

test('a plan source draft shows its plan and cannot be edited or issued', async () => {
  renderDetail('inv_source')
  expect(await screen.findByText(/2 of 6 issued/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Issue' })).not.toBeInTheDocument()
  const items = await menuItems()
  expect(items).not.toContain('Edit draft')
  expect(items).not.toContain('Delete draft')
  expect(items).not.toContain('Split into instalment invoices')
})

test('outside-scope VAT without a seller registration number blocks the XML menu', () => {
  const outside = { category: 'O' } as const
  const none = { registration_number: null }
  const some = { registration_number: 'CHE-1' }
  expect(einvoiceBlock({ vat_breakdown: [outside], seller: none })).toMatch(/registration/)
  expect(einvoiceBlock({ vat_breakdown: [outside], seller: some })).toBeNull()
  expect(einvoiceBlock({ vat_breakdown: [outside, { category: 'S' }], seller: some })).toMatch(
    /separate documents/,
  )
})
