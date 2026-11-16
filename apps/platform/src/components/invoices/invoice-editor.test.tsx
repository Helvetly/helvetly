import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { Invoice, InvoiceInput } from '@/lib/invoices'
import {
  editorApi,
  listItem,
  previewRows,
  sampleInvoice as baseInvoice,
  sampleSchedule,
  sampleSettings,
} from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { parseCompose } from './compose'
import { InvoiceEditorDrawer } from './invoice-editor'

const push = vi.fn<(href: string) => void>()
const onClose = vi.fn<() => void>()
const onCreated = vi.fn<(id: string) => void>()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn<() => void>() }),
  usePathname: () => '/invoices/new',
  useSearchParams: () => search,
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

const clients = [
  sampleClient(),
  sampleClient({
    id: 'cli_2',
    number: 2,
    name: 'Weber Design',
    street: null,
    zip: null,
    is_draft: true,
    missing_fields: ['street', 'zip'],
  }),
]
const requests: { method: string; path: string; body: unknown }[] = []
const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({ user: { id: 'usr_1', name: 'Anna' }, role: 'owner', csrf_token: 't' }),
  ),
  http.get('/api/v1/clients', () =>
    HttpResponse.json({ data: clients, meta: { page: 1, page_size: 8, total: 2, total_pages: 1 } }),
  ),
  http.get<{ id: string }>('/api/v1/clients/:id', ({ params }) => {
    const client = clients.find((entry) => entry.id === params.id)
    return client ? HttpResponse.json({ data: client }) : new HttpResponse(null, { status: 404 })
  }),
  // The prepayment picker lists a client's paid prepayments; none unless a test adds some.
  http.get('/api/v1/invoices', () =>
    HttpResponse.json({ data: [], meta: { page: 1, page_size: 50, total: 0, total_pages: 0 } }),
  ),
  ...editorApi(clients),
)
server.events.on('request:start', async ({ request }) => {
  if (request.method === 'GET') return
  const path = new URL(request.url).pathname
  requests.push({
    method: request.method,
    path,
    body: await request
      .clone()
      .json()
      .catch(() => null),
  })
})
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  requests.length = 0
  onClose.mockClear()
  onCreated.mockClear()
  search = new URLSearchParams()
})
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

const renderEditor = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider>
          <InvoiceEditorDrawer
            compose={
              parseCompose('/invoices/new', search) ?? { id: null, kind: 'invoice', client: null }
            }
            onClose={onClose}
            onCreated={onCreated}
          />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

const pick = async (name: string) => {
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }))
}

test('picking a client starts a draft; typing autosaves it and totals come from the server', async () => {
  renderEditor()
  // The picker is open from the start: the client is the first thing an invoice needs.
  await pick('Alpenglow')
  expect(screen.getByRole('button', { name: /Client: Alpenglow Studio GmbH/ })).toBeInTheDocument()

  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Workshop')
  await userEvent.clear(screen.getByLabelText('Line 1 quantity'))
  await userEvent.type(screen.getByLabelText('Line 1 quantity'), '2')
  await userEvent.type(screen.getByLabelText('Line 1 price'), "1'450")

  // 2 × 1'450 + 8.1 % VAT = 3'134.90 (from POST /preview, never computed here).
  expect(await screen.findByText('3’134.90', {}, { timeout: 3000 })).toBeInTheDocument()
  await waitFor(
    () =>
      expect(requests.some((r) => r.method === 'POST' && r.path === '/api/v1/invoices')).toBe(true),
    { timeout: 3000 },
  )
  const created = requests.find((r) => r.method === 'POST' && r.path === '/api/v1/invoices')
  expect(created?.body).toMatchObject({
    client_id: 'cli_1',
    currency: 'CHF',
    lines: [
      {
        description: 'Workshop',
        quantity: '2',
        unit_price: '1450.00',
        vat_category: 'S',
        vat_rate: '8.1',
      },
    ],
  })
  expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/^inv_/))
})

test('Enter in a description adds the next line and keeps typing there', async () => {
  renderEditor()
  await pick('Alpenglow')
  const first = screen.getByLabelText('Line 1 description')
  await userEvent.type(first, 'Design{Enter}Hosting')
  expect(first).toHaveValue('Design')
  expect(screen.getByLabelText('Line 2 description')).toHaveValue('Hosting')
  expect(screen.getByLabelText('Line 2 description')).toHaveFocus()
  expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument()
})

test('repeated save shortcuts during creation keep one draft and the latest edits', async () => {
  const started = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const creates: Partial<InvoiceInput>[] = []
  const writes: Partial<InvoiceInput>[] = []
  server.use(
    http.post<never, Partial<InvoiceInput>>('/api/v1/invoices', async ({ request }) => {
      const input = await request.json()
      creates.push(input)
      const id = `inv_${creates.length}`
      started.resolve()
      await resume.promise
      writes.push(input)
      return HttpResponse.json({ data: sampleInvoice({ id }) }, { status: 201 })
    }),
    http.patch<{ id: string }, Partial<InvoiceInput>>(
      '/api/v1/invoices/:id',
      async ({ params, request }) => {
        writes.push(await request.json())
        return HttpResponse.json({ data: sampleInvoice({ id: params.id }) })
      },
    ),
  )
  renderEditor()
  await pick('Alpenglow')
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Workshop')
  fireEvent.keyDown(window, { key: 's', metaKey: true })
  try {
    await started.promise
    await userEvent.type(screen.getByLabelText('Line 1 description'), ' and follow-up')
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    fireEvent.keyDown(window, { key: 's', metaKey: true })
  } finally {
    resume.resolve()
  }

  expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(writes.at(-1)).toMatchObject({
    lines: [{ description: 'Workshop and follow-up' }],
  })
  expect(creates).toHaveLength(1)
})

test('issuing a draft for a draft client lists every reason with a way to fix it', async () => {
  renderEditor()
  await pick('Weber')
  expect(screen.getByText(/can be drafted but not issued/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Logo')
  await userEvent.type(screen.getByLabelText('Line 1 price'), '980')

  await userEvent.click(screen.getByRole('button', { name: 'Issue invoice' }))
  const confirm = await screen.findByRole('dialog', {}, { timeout: 3000 })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Issue invoice' }))

  const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
  expect(within(alert).getByText("Complete the client's address: street, zip.")).toBeInTheDocument()
  expect(within(alert).getByRole('link', { name: /Complete the client/ })).toHaveAttribute(
    'href',
    '/clients?id=cli_2',
  )
  // One row per missing company field reads as a list: they are merged, linking to the first.
  expect(
    within(alert).getByText('Your company details are missing: ZIP, City.'),
  ).toBeInTheDocument()
  expect(within(alert).getByRole('link', { name: /Company details/ })).toHaveAttribute(
    'href',
    '/settings/invoices?focus=seller.zip#company',
  )
  expect(within(alert).getAllByRole('listitem')).toHaveLength(2)
  expect(push).not.toHaveBeenCalled()
})

test('a client from the URL is preset, and issuing goes to the issued invoice', async () => {
  search = new URLSearchParams('client=cli_1')
  renderEditor()
  expect(
    await screen.findByRole('button', { name: /Client: Alpenglow Studio GmbH/ }),
  ).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Annual accounts')
  await userEvent.type(screen.getByLabelText('Line 1 price'), '2850')
  await userEvent.click(screen.getByRole('button', { name: 'Issue invoice' }))
  await userEvent.click(
    within(await screen.findByRole('dialog', {}, { timeout: 3000 })).getByRole('button', {
      name: 'Issue invoice',
    }),
  )
  await waitFor(
    () => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/invoices\?id=inv_/)),
    { timeout: 3000 },
  )
})

test('a QR bill that cannot apply is shown off with why, and the saved choice is cleared', async () => {
  let patched: unknown = null
  server.use(
    http.get('/api/v1/invoice-settings', () =>
      HttpResponse.json({ data: sampleSettings({ iban: 'DE89370400440532013000' }) }),
    ),
    http.get('/api/v1/invoices/inv_9', () =>
      HttpResponse.json({
        data: sampleInvoice({
          id: 'inv_9',
          client_id: 'cli_1',
          payment_methods: { qr_bill: true, revolut: false },
        }),
      }),
    ),
    http.patch('/api/v1/invoices/inv_9', async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ data: sampleInvoice({ id: 'inv_9', client_id: 'cli_1' }) })
    }),
  )
  search = new URLSearchParams('id=inv_9')
  renderEditor()
  const toggle = await screen.findByRole('checkbox', { name: 'QR bill' })
  expect(toggle).toBeDisabled()
  expect(toggle).not.toBeChecked()
  await waitFor(
    () => expect(patched).toMatchObject({ payment_methods: { qr_bill: false, revolut: false } }),
    { timeout: 3000 },
  )
})

test('a new proforma has no payment methods and is created as a proforma', async () => {
  search = new URLSearchParams('kind=proforma&client=cli_1')
  renderEditor()
  expect(await screen.findByRole('heading', { name: 'Proforma invoice' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Issue proforma invoice' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'QR bill' })).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Estimate')
  await waitFor(
    () =>
      expect(requests.some((r) => r.method === 'POST' && r.path === '/api/v1/invoices')).toBe(true),
    { timeout: 3000 },
  )
  const created = requests.find((r) => r.method === 'POST' && r.path === '/api/v1/invoices')
  expect(created?.body).toMatchObject({ kind: 'proforma' })
  expect(created?.body).not.toHaveProperty('payment_methods')
  expect(created?.body).not.toHaveProperty('prepayment_ids')
})

test('ticking a paid prepayment saves its id and deducts it in the totals', async () => {
  let listed = ''
  let patched: unknown = null
  const prepayment = sampleInvoice({
    id: 'inv_p1',
    kind: 'prepayment',
    type_code: '386',
    number: '2026-003',
    status: 'paid',
    payable_total: '1000.00',
  })
  server.use(
    http.get('/api/v1/invoices', ({ request }) => {
      listed = new URL(request.url).search
      return HttpResponse.json({
        data: [listItem(prepayment), listItem({ ...prepayment, id: 'inv_p2', currency: 'EUR' })],
        meta: { page: 1, page_size: 50, total: 2, total_pages: 1 },
      })
    }),
    http.get('/api/v1/invoices/inv_9', () =>
      HttpResponse.json({ data: sampleInvoice({ id: 'inv_9', lines: [] }) }),
    ),
    http.patch('/api/v1/invoices/inv_9', async ({ request }) => {
      patched = await request.json()
      return HttpResponse.json({ data: sampleInvoice({ id: 'inv_9' }) })
    }),
  )
  search = new URLSearchParams('id=inv_9')
  renderEditor()
  const option = await screen.findByRole('checkbox', { name: /Prepayment 2026-003/ })
  // The EUR prepayment is in another currency than the draft.
  expect(screen.getAllByRole('checkbox', { name: /Prepayment/ })).toHaveLength(1)
  expect(listed).toMatch(/kind=prepayment/)
  expect(listed).toMatch(/status=paid/)
  expect(listed).toMatch(/client_id=cli_1/)

  await userEvent.click(option)
  await waitFor(() => expect(patched).toMatchObject({ prepayment_ids: ['inv_p1'] }), {
    timeout: 3000,
  })
  expect(screen.getByText('Prepayment 2026-003', { selector: 'dt' })).toBeInTheDocument()
  // 3'134.90 from the preview, less the 1'000.00 prepaid.
  expect(await screen.findByText('2’134.90')).toBeInTheDocument()
})

test.each([
  { rows: previewRows, typed: false },
  { rows: [...previewRows.slice(0, 2), ['2027-02-05', '900.00']], typed: true },
])(
  'a reopened draft keeps typed rows, else follows the server ($typed)',
  async ({ rows, typed }) => {
    const draft = sampleInvoice({ id: 'inv_9', instalments: sampleSchedule(rows) })
    server.use(http.get('/api/v1/invoices/inv_9', () => HttpResponse.json({ data: draft })))
    search = new URLSearchParams('id=inv_9')
    renderEditor()
    expect(await screen.findByRole('textbox', { name: 'Instalment 3 amount' })).toHaveValue(
      rows[2]?.[1],
    )
    // The preview's rows arrive; only rows equal to them become generated again.
    await waitFor(() =>
      expect(requests.some((r) => r.path === '/api/v1/invoices/preview')).toBe(true),
    )
    await waitFor(() =>
      expect(Boolean(screen.queryByRole('button', { name: 'Equal parts' }))).toBe(typed),
    )
  },
)

test('a debit note shows the invoice it adds to, read-only', async () => {
  server.use(
    http.get('/api/v1/invoices/inv_9', () =>
      HttpResponse.json({
        data: sampleInvoice({
          id: 'inv_9',
          kind: 'debit_note',
          type_code: '383',
          credited_invoice: { id: 'inv_1', number: '2026-001' },
        }),
      }),
    ),
    http.get('/api/v1/invoices/inv_1', () =>
      HttpResponse.json({ data: sampleInvoice({ number: '2026-001', status: 'open' }) }),
    ),
    http.patch('/api/v1/invoices/inv_9', () =>
      HttpResponse.json({ data: sampleInvoice({ id: 'inv_9', kind: 'debit_note' }) }),
    ),
  )
  search = new URLSearchParams('id=inv_9')
  renderEditor()
  expect(await screen.findByText(/Debit note on invoice/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '2026-001' })).toHaveAttribute(
    'href',
    '/invoices?id=inv_1',
  )
  expect(screen.getByRole('heading', { name: 'Debit note' })).toBeInTheDocument()
})

test('a kind that cannot be created from scratch falls back to an invoice', async () => {
  search = new URLSearchParams('kind=credit_note&client=cli_1')
  renderEditor()
  expect(await screen.findByRole('heading', { name: 'Invoice' })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Workshop')
  await waitFor(
    () =>
      expect(
        requests.find((r) => r.method === 'POST' && r.path === '/api/v1/invoices')?.body,
      ).toMatchObject({ kind: 'invoice' }),
    { timeout: 3000 },
  )
})

test('closing the editor while a save is in flight still saves what was typed meanwhile', async () => {
  const started = Promise.withResolvers<void>()
  const resume = Promise.withResolvers<void>()
  const creates: Partial<InvoiceInput>[] = []
  const writes: Partial<InvoiceInput>[] = []
  server.use(
    http.post<never, Partial<InvoiceInput>>('/api/v1/invoices', async ({ request }) => {
      const input = await request.json()
      creates.push(input)
      started.resolve()
      await resume.promise
      writes.push(input)
      return HttpResponse.json({ data: sampleInvoice({ id: 'inv_1' }) }, { status: 201 })
    }),
    http.patch<{ id: string }, Partial<InvoiceInput>>(
      '/api/v1/invoices/:id',
      async ({ params, request }) => {
        writes.push(await request.json())
        return HttpResponse.json({ data: sampleInvoice({ id: params.id }) })
      },
    ),
  )
  const { unmount } = renderEditor()
  await pick('Alpenglow')
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Workshop')
  fireEvent.keyDown(window, { key: 's', metaKey: true })
  try {
    await started.promise
    await userEvent.type(screen.getByLabelText('Line 1 description'), ' and follow-up')
    unmount()
  } finally {
    resume.resolve()
  }

  await waitFor(() =>
    expect(writes.at(-1)).toMatchObject({ lines: [{ description: 'Workshop and follow-up' }] }),
  )
  expect(creates).toHaveLength(1)
})

test('closing an untouched new editor needs no question', async () => {
  renderEditor()
  await screen.findByLabelText('Line 1 description')
  await userEvent.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('closing typed work that autosave would not keep asks to discard it, with the button and with Esc', async () => {
  renderEditor()
  // No client yet, so nothing is saved: closing would throw the line away.
  await userEvent.type(await screen.findByLabelText('Line 1 description'), 'Workshop')
  await userEvent.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
      'button',
      { name: 'Keep editing' },
    ),
  )
  expect(onClose).not.toHaveBeenCalled()

  await userEvent.keyboard('{Escape}')
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
      'button',
      { name: 'Discard' },
    ),
  )
  expect(onClose).toHaveBeenCalledOnce()
})

test('a draft that has a client closes without a question: autosave keeps it', async () => {
  renderEditor()
  await pick('Alpenglow')
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Workshop')
  await userEvent.type(screen.getByLabelText('Line 1 price'), '100')
  await userEvent.click(screen.getByRole('button', { name: 'Close editor' }))
  expect(onClose).toHaveBeenCalledOnce()
})

// Browser Back with input that cannot be saved (no client yet): the Back becomes the discard question.
const typeUnsaved = async () => {
  renderEditor()
  await userEvent.type(await screen.findByLabelText('Line 1 description'), 'Workshop')
}
const backButton = () => act(() => window.dispatchEvent(new PopStateEvent('popstate')))

test('Back with unsavable input asks to discard; Keep editing retains it and guards again', async () => {
  const pushed = vi.spyOn(window.history, 'pushState')
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  await typeUnsaved()
  expect(pushed).toHaveBeenCalledOnce() // one guard entry, once

  backButton()
  const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
  expect(back).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Line 1 description')).toHaveValue('Workshop')
  expect(pushed).toHaveBeenCalledTimes(2) // the guard is back for the next Back

  backButton()
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
      'button',
      { name: 'Discard' },
    ),
  )
  expect(back).toHaveBeenCalledOnce() // the Back goes on, once
  expect(onClose).not.toHaveBeenCalled()
})

/** Whether the tab-close warning would ask. */
const warns = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

// The tab-close warning guards before and after Keep editing, but not the departure the person approved with Discard.
test('an explicit Discard on Back is not asked again by the tab-close warning', async () => {
  vi.spyOn(window.history, 'back').mockImplementation(() => {})
  await typeUnsaved()
  expect(warns()).toBe(true)
  backButton()
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
      'button',
      {
        name: 'Keep editing',
      },
    ),
  )
  expect(warns()).toBe(true) // kept: reload and tab close still warn
  backButton()
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
      'button',
      {
        name: 'Discard',
      },
    ),
  )
  expect(warns()).toBe(false) // the approved departure goes without a second question
  backButton() // the Back stayed on this page: the warning is armed again
  expect(warns()).toBe(true)
})

test('an untouched editor adds no history entry', async () => {
  const pushed = vi.spyOn(window.history, 'pushState')
  renderEditor()
  await screen.findByLabelText('Line 1 description')
  expect(pushed).not.toHaveBeenCalled()
})

test('closing with the button after the guard was set removes the guard, then closes once', async () => {
  const pushed = vi.spyOn(window.history, 'pushState')
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await typeUnsaved()
  expect(pushed).toHaveBeenCalledOnce()
  await userEvent.click(screen.getByRole('button', { name: 'Close editor' }))
  await userEvent.click(
    within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
      'button',
      { name: 'Discard' },
    ),
  )
  expect(back).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})

test('closing the tab warns about typed input that cannot be saved', async () => {
  await typeUnsaved()
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})

test('closing the tab of an untouched editor does not warn', async () => {
  renderEditor()
  await screen.findByLabelText('Line 1 description')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})
