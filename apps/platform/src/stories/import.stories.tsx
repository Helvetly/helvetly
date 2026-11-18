import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { billingFixture } from '@/components/billing/billing-fixture'
import { dropdownKit } from '@/components/data/menus'
import { ImportItem } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import type { ImportBatch, ImportFile, ImportRecord, ImportSummary } from '@/lib/imports'
import { aiConsent, aiNotice } from '@/mocks/ai-notice'
import { editorApi } from '@/test/invoice-api'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import',
  parameters: { layout: 'fullscreen' },
  render: () => <ImportDrawer kind="clients" onClose={() => {}} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const file = (over: Partial<ImportFile> = {}): ImportFile => ({
  id: 'imf_1',
  name: 'clients.xlsx',
  size: 48_000,
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  status: 'done',
  error: null,
  chunks_done: 1,
  chunks_total: 1,
  reused: false,
  document_type: null,
  ...over,
})

const record = (id: string, over: Partial<ImportRecord> = {}): ImportRecord => ({
  id,
  file_id: 'imf_1',
  kind: 'clients',
  status: 'pending',
  data: { name: 'Muster AG', email: 'info@muster.ch', city: 'Bern', country: 'CH' },
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
  ...over,
})

const clean = record('imr_clean')
const flawed = record('imr_issue', {
  data: { name: 'Beta GmbH', email: 'beta(at)example', city: 'Zürich', country: 'CH' },
  issues: { email: 'Enter a valid email address.' },
})
const duplicate = record('imr_dup', {
  data: { name: 'Gamma SA', email: 'hello@gamma.ch', city: 'Genève', country: 'CH' },
  duplicate: { id: 'cli_7', label: 'Gamma SA', reason: 'same name' },
})

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  id: 'imp_story',
  kind: 'clients',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  files: [file(), file({ id: 'imf_2', name: 'contacts.zip › old.pdf', reused: true })],
  records: [clean, flawed, duplicate],
  ...over,
})

const extracting = batch({
  status: 'extracting',
  files: [
    file({ status: 'extracting', chunks_done: 2, chunks_total: 5 }),
    file({ id: 'imf_2', name: 'notes.docx', status: 'queued', chunks_done: 0, chunks_total: null }),
  ],
  records: [],
})

const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  id: 'imp_story',
  kind: 'clients',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  pending: 3,
  ...over,
})

const fail = (status: number, code: string, message: string, details = {}) =>
  HttpResponse.json({ error: { code, message, details } }, { status })

const noBatches = http.get('/api/v1/imports', () => HttpResponse.json({ data: [] }))
const resumable = http.get('/api/v1/imports', () => HttpResponse.json({ data: [summary()] }))
const getBatch = (value: () => ImportBatch) =>
  http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: value() }))

const body = () => within(document.body)

/** Waits for the sheet to finish sliding in, so visibility checks see it opaque. */
async function opened(name = 'Import clients') {
  const dialog = await body().findByRole('dialog', { name })
  await waitFor(() => expect(dialog).toBeVisible())
}

/** Chooses one spreadsheet in the drop zone and presses "Process with AI". */
async function chooseAndRead() {
  await opened()
  const input = await body().findByLabelText('Choose files to import')
  await userEvent.upload(input, new File(['name;email\nMuster AG;info@muster.ch'], 'clients.csv'))
  await expect(body().getByText('clients.csv')).toBeVisible()
  await userEvent.click(body().getByRole('button', { name: 'Process with AI' }))
}

/** Opens the unfinished batch the drawer offers. */
async function continueImport() {
  await waitFor(() => expect(body().getByRole('dialog')).toBeVisible())
  await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
  await body().findByRole('table', { name: 'Records found' })
}

/** The first visit: a drop zone that explains itself; nothing to read yet. */
export const Empty: Story = {
  parameters: { msw: { handlers: [sessionHandler(), noBatches] } },
  play: async () => {
    await opened()
    await expect(body().getByText(/nothing is created until you choose rows/)).toBeVisible()
    await expect(body().getByRole('list', { name: 'How the import works' })).toBeVisible()
    await expect(body().getByText(/Up to 25 files of 25 MB each/)).toBeVisible()
    await expect(body().getByRole('button', { name: 'Process with AI' })).toBeDisabled()
    await expect(body().queryByRole('button', { name: 'Continue import' })).toBeNull()
  },
}

/** A file over 25 MB is refused before upload in a toast, so the zone and the list below do not move. */
export const TooLarge: Story = {
  parameters: { msw: { handlers: [sessionHandler(), noBatches] } },
  render: () => (
    <>
      <ImportDrawer kind="clients" onClose={() => {}} />
      <Toaster />
    </>
  ),
  play: async () => {
    await opened()
    const zone = body().getByLabelText('Choose files to import')
    const top = zone.getBoundingClientRect().top
    await userEvent.upload(zone, [
      new File(['a,b'], 'clients.csv', { type: 'text/csv' }),
      new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'scan.pdf', { type: 'application/pdf' }),
    ])
    await expect(await body().findByText('scan.pdf is over 25 MB.')).toBeInTheDocument()
    const chosen = body().getByRole('list', { name: 'Chosen files' })
    await expect(within(chosen).getByText('clients.csv')).toBeVisible()
    await expect(within(chosen).queryByText('scan.pdf')).toBeNull()
    await expect(zone.getBoundingClientRect().top).toBe(top)
  },
}

/** While the files go up, the drawer cannot be closed and the action says so. */
export const Uploading: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        noBatches,
        http.post('/api/v1/imports', async () => {
          await delay('infinite')
          return HttpResponse.json({ data: extracting }, { status: 201 })
        }),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(await body().findByRole('button', { name: 'Uploading…' })).toBeDisabled()
    await expect(body().getByRole('button', { name: 'Close' })).toBeDisabled()
  },
}

/** Each file shows how far the AI got, polled every 2 s. */
export const Extracting: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        noBatches,
        http.post('/api/v1/imports', () =>
          HttpResponse.json({ data: extracting }, { status: 201 }),
        ),
        getBatch(() => extracting),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(await body().findByText('Reading part 2 of 5')).toBeVisible()
    await expect(body().getByText('Waiting')).toBeVisible()
    await expect(body().getByText('Read 0 of 2 files…')).toBeVisible()
  },
}

/** Only clean rows start ticked: the duplicate and the row with an issue wait for a look. */
export const ReviewWithIssues: Story = {
  parameters: {
    msw: { handlers: [sessionHandler(), resumable, getBatch(() => batch())] },
  },
  play: async () => {
    await continueImport()
    await expect(body().getByRole('checkbox', { name: 'Select Muster AG' })).toBeChecked()
    await expect(body().getByRole('checkbox', { name: 'Select Beta GmbH' })).not.toBeChecked()
    await expect(body().getByRole('checkbox', { name: 'Select Gamma SA' })).not.toBeChecked()
    await expect(
      body().getByRole('button', { name: /Email: Enter a valid email address./ }),
    ).toBeVisible()
    await expect(body().getByText('1 row needs a fix')).toBeVisible()
    await expect(body().getByText('Possible duplicate: Gamma SA (same name)')).toBeVisible()
    await expect(body().getByText(/already in Documents/)).toBeVisible()
    await expect(body().getByRole('button', { name: 'Import 1' })).toBeEnabled()
    await userEvent.click(body().getByRole('checkbox', { name: 'Select all' }))
    await expect(body().getByRole('button', { name: 'Import 3' })).toBeEnabled()
    await userEvent.click(body().getByRole('checkbox', { name: 'Select all' }))
    await expect(body().getByRole('button', { name: 'Import 0' })).toBeDisabled()
  },
}

let edited = batch()
/** Fixing a row in place: the PATCH re-checks it, the issue goes and the row gets ticked. */
export const EditRecord: Story = {
  beforeEach: () => {
    edited = batch()
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        resumable,
        getBatch(() => edited),
        http.patch<{ id: string; record: string }, { data: Record<string, string | null> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            const { data } = await request.json()
            const fixed = record('imr_issue', {
              data: { ...flawed.data, email: data.email ?? '' },
            })
            edited = {
              ...edited,
              records: edited.records.map((r) => (r.id === fixed.id ? fixed : r)),
            }
            return HttpResponse.json({ data: fixed })
          },
        ),
      ],
    },
  },
  play: async () => {
    await continueImport()
    await userEvent.click(body().getByRole('button', { name: 'Edit Beta GmbH' }))
    // A second drawer over the import one, not a view that replaces the list.
    const editor = await body().findByRole('dialog', { name: 'Edit record' })
    const email = await within(editor).findByRole('textbox', { name: 'Email' })
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await userEvent.clear(email)
    await userEvent.type(email, 'info@beta.ch')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body().queryByRole('dialog', { name: 'Edit record' })).toBeNull())
    await body().findByRole('table', { name: 'Records found' })
    await expect(body().queryByRole('button', { name: /Enter a valid email/ })).toBeNull()
    await expect(body().getByText('info@beta.ch')).toBeVisible()
    await expect(body().getByRole('checkbox', { name: 'Select Beta GmbH' })).toBeChecked()
    await expect(body().getByRole('button', { name: 'Import 2' })).toBeEnabled()
  },
}

let committed = batch({ records: [clean, record('imr_two', { data: { name: 'Delta AG' } })] })
/** One row is created, the next one hits the plan's client limit: both outcomes stay visible. */
export const CommitPartialSuccess: Story = {
  beforeEach: () => {
    committed = batch({ records: [clean, record('imr_two', { data: { name: 'Delta AG' } })] })
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        resumable,
        getBatch(() => committed),
        http.post('/api/v1/imports/:id/commit', () => {
          committed = batch({
            records: [
              { ...clean, status: 'created', entity_id: 'cli_42' },
              record('imr_two', {
                data: { name: 'Delta AG' },
                status: 'failed',
                error: 'Your Basic plan includes 10 clients.',
              }),
            ],
          })
          return HttpResponse.json({
            data: {
              results: [
                {
                  id: 'imr_clean',
                  status: 'created',
                  entity_id: 'cli_42',
                  error: null,
                  conflict: null,
                },
                {
                  id: 'imr_two',
                  status: 'failed',
                  entity_id: null,
                  error: { code: 'limit_reached', message: 'Your Basic plan includes 10 clients.' },
                  conflict: null,
                },
              ],
              batch: committed,
            },
          })
        }),
      ],
    },
  },
  play: async () => {
    await continueImport()
    await userEvent.click(body().getByRole('button', { name: 'Import 2' }))
    await expect(await body().findByText('1 created, 1 needs attention')).toBeVisible()
    await expect(body().getByText('Created')).toBeVisible()
    await expect(body().getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      expect.stringContaining('cli_42'),
    )
    await expect(body().getByText('Your Basic plan includes 10 clients.')).toBeVisible()
    await expect(body().getByRole('link', { name: 'See plans' })).toBeVisible()
    await expect(body().getByRole('checkbox', { name: 'Select Delta AG' })).toBeChecked()
  },
}

let uploads = 0
let approved = false
const approvalHandlers = [
  sessionHandler({ role: 'member' }),
  noBatches,
  http.get('/api/v1/heidi/usage', () =>
    HttpResponse.json({
      period: '2026-11',
      tokens_used: 0,
      tokens_included: null,
      tokens_purchased: 0,
      tokens_remaining: null,
      provider_available: true,
      consent: aiConsent(approved),
    }),
  ),
  http.get('/api/v1/heidi/consent', () =>
    HttpResponse.json({ data: aiConsent(approved), notice: aiNotice }),
  ),
  http.put('/api/v1/heidi/consent', () => {
    approved = true
    return HttpResponse.json({ data: aiConsent(true) })
  }),
  http.post('/api/v1/imports', () => {
    uploads++
    return HttpResponse.json({ data: extracting }, { status: 201 })
  }),
  getBatch(() => extracting),
]
const withApproval: Partial<Story> = {
  beforeEach: () => {
    uploads = 0
    approved = false
  },
  parameters: { msw: { handlers: approvalHandlers } },
  render: () => (
    <AIApprovalProvider>
      <ImportDrawer kind="clients" onClose={() => {}} />
    </AIApprovalProvider>
  ),
}

/** First AI use: Not now uploads nothing and keeps the chosen file. Any member decides for themselves. */
export const ApprovalNotNow: Story = {
  ...withApproval,
  play: async () => {
    await chooseAndRead()
    const ask = await body().findByRole('dialog', { name: aiNotice.title })
    await userEvent.click(within(ask).getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(body().queryByRole('dialog', { name: aiNotice.title })).toBeNull())
    await expect(body().getByText('clients.csv')).toBeVisible()
    await expect(uploads).toBe(0)
  },
}

/** Approving reads the files once. */
export const ApprovalApprove: Story = {
  ...withApproval,
  play: async () => {
    await chooseAndRead()
    const ask = await body().findByRole('dialog', { name: aiNotice.title })
    await userEvent.click(within(ask).getByRole('button', { name: 'Approve and continue' }))
    await expect(await body().findByText('Reading part 2 of 5')).toBeVisible()
    await expect(uploads).toBe(1)
  },
}

let noticeReads = 0
const earlierNotice = { ...aiNotice, version: '2000-01-01', lead: 'The earlier notice.' }

/**
 * A new notice deployed while the question was open: approving the earlier one is refused, the current notice is
 * shown with a line that it changed, and only the person's second approval reads the files, once.
 */
export const ApprovalNoticeChanged: Story = {
  ...withApproval,
  beforeEach: () => {
    uploads = 0
    approved = false
    noticeReads = 0
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/consent', () =>
          HttpResponse.json({
            data: aiConsent(false),
            notice: ++noticeReads === 1 ? earlierNotice : aiNotice,
          }),
        ),
        http.put('/api/v1/heidi/consent', async ({ request }) => {
          const { version } = (await request.json()) as { version?: string }
          if (version !== aiNotice.version)
            return fail(409, 'ai_consent_version_changed', 'The AI notice has changed.')
          approved = true
          return HttpResponse.json({ data: aiConsent(true) })
        }),
        ...approvalHandlers,
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    const ask = await body().findByRole('dialog', { name: aiNotice.title })
    await expect(ask).toHaveAccessibleDescription('The earlier notice.')
    await userEvent.click(within(ask).getByRole('button', { name: 'Approve and continue' }))
    await expect(await within(ask).findByRole('status')).toHaveTextContent(
      'This notice has changed since it was shown',
    )
    await waitFor(() => expect(ask).toHaveAccessibleDescription(aiNotice.lead))
    await expect(uploads).toBe(0)
    await userEvent.click(within(ask).getByRole('button', { name: 'Approve and continue' }))
    await expect(await body().findByText('Reading part 2 of 5')).toBeVisible()
    await expect(uploads).toBe(1)
  },
}

/** Approval withdrawn elsewhere: the server's refusal offers the same approval, then reads once. */
export const ApprovalRequiredByServer: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member' }),
        noBatches,
        http.post('/api/v1/imports', () =>
          fail(403, 'ai_consent_required', 'You have not approved AI use in this workspace yet.'),
        ),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(
      await body().findByText('You haven’t approved AI use in this workspace yet'),
    ).toBeVisible()
    await expect(body().getByRole('button', { name: 'Review and approve' })).toBeVisible()
  },
}

/** Storage is full: the plan's message and the way to the plans. */
export const PlanLimit: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        noBatches,
        http.post('/api/v1/imports', () =>
          fail(402, 'limit_reached', 'Your storage is full. Upgrade for more space.', {
            limit: 'storage_bytes',
            used: 500,
            max: 500,
            plan: 'basic',
          }),
        ),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(
      await body().findByText('Your storage is full. Upgrade for more space.'),
    ).toBeVisible()
    await expect(body().getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans/),
    )
  },
}

let attempts = 0
/** A server error keeps the chosen files; "Try again" sends them again. */
export const ErrorAndRetry: Story = {
  beforeEach: () => {
    attempts = 0
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        noBatches,
        http.post('/api/v1/imports', () => {
          attempts += 1
          return attempts === 1
            ? fail(500, 'internal', 'Something went wrong on our side.')
            : HttpResponse.json({ data: extracting }, { status: 201 })
        }),
        getBatch(() => extracting),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(await body().findByText('Something went wrong on our side.')).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Try again' }))
    await expect(await body().findByText('Reading part 2 of 5')).toBeVisible()
    await waitFor(() => expect(attempts).toBe(2))
  },
}

/** The review of a products import, in dark mode. */
export const DarkReview: Story = {
  parameters: {
    dark: true,
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/imports', () =>
          HttpResponse.json({ data: [summary({ kind: 'products' })] }),
        ),
        getBatch(() =>
          batch({
            kind: 'products',
            records: [
              record('imr_p1', {
                data: {
                  type: 'service',
                  name: 'Web design',
                  unit: 'hour',
                  unit_price: '150.00',
                  currency: 'CHF',
                },
              }),
              record('imr_p2', {
                data: {
                  type: 'product',
                  name: 'Office chair',
                  sku: 'CH-1',
                  unit_price: 'abc',
                  currency: 'CHF',
                },
                issues: { unit_price: 'Enter a price like 49.90.' },
              }),
            ],
          }),
        ),
      ],
    },
  },
  render: () => <ImportDrawer kind="products" onClose={() => {}} />,
  play: async () => {
    await opened('Import products & services')
    await continueImport()
    await expect(body().getByRole('checkbox', { name: 'Select Web design' })).toBeChecked()
    await expect(body().getByRole('checkbox', { name: 'Select Office chair' })).not.toBeChecked()
    await expect(body().getByRole('button', { name: /Enter a price like 49.90./ })).toBeVisible()
  },
}

const onPlan = (plan: 'basic' | 'pro') =>
  http.get('/api/v1/billing', () =>
    HttpResponse.json({ data: billingFixture({ plan, status: 'active' }) }),
  )

/** Basic has no AI import: the drawer names Pro and its way to the plans, and nothing can be chosen or read. */
export const NotInPlan: Story = {
  parameters: { msw: { handlers: [sessionHandler(), noBatches, onPlan('basic')] } },
  play: async () => {
    await opened()
    await expect(
      await body().findByText(/Your plan doesn’t include the AI import; Pro does\./),
    ).toBeVisible()
    await expect(body().getByText(/Imports already read stay open for review\./)).toBeVisible()
    await expect(body().getByRole('link', { name: 'See Pro' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/settings\/billing\/plans/),
    )
    await expect(body().getByLabelText('Choose files to import')).toBeDisabled()
    await expect(body().getByRole('button', { name: 'Process with AI' })).toBeDisabled()
  },
}

const ImportMenu = () => {
  const [drawer, setDrawer] = useState(false)
  return (
    <div className="p-8">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">More actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ImportItem Item={dropdownKit.Item} onSelect={() => setDrawer(true)}>
            Import
          </ImportItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {drawer && <p>Drawer opened</p>}
    </div>
  )
}

/** A page's "…" menu on Basic: Import is off, tagged with the plan that has it. */
export const MenuItemOnBasic: Story = {
  render: () => <ImportMenu />,
  parameters: { layout: 'centered', msw: { handlers: [sessionHandler(), onPlan('basic')] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'More actions' }))
    const item = await body().findByRole('menuitem', { name: /Import/ })
    await waitFor(() => expect(item).toHaveAttribute('data-disabled'))
    await expect(item.querySelector('[data-slot=plan-tag]')).toHaveTextContent('Pro')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(item).not.toBeInTheDocument())
  },
}

/** On Pro the same item opens the import. */
export const MenuItemOnPro: Story = {
  render: () => <ImportMenu />,
  parameters: { layout: 'centered', msw: { handlers: [sessionHandler(), onPlan('pro')] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await body().findByRole('menuitem', { name: 'Import' }))
    await expect(await canvas.findByText('Drawer opened')).toBeVisible()
  },
}

const invoiceRecord = (id: string, over: Partial<ImportRecord> = {}) =>
  record(id, {
    file_id: 'imf_inv',
    kind: 'invoices',
    data: {
      number: 'RE-1001',
      client_name: 'Muster AG',
      client_street: 'Bahnhofstrasse',
      client_street_number: '12',
      client_zip: '8001',
      client_city: 'Zürich',
      client_country: 'CH',
      client_vat_number: 'CHE-123.456.789 MWST',
      lines: [
        {
          description: 'Website care',
          quantity: '10',
          unit: 'hour',
          unit_price: '120.00',
          vat_category: 'S',
          vat_rate: '8.1',
        },
      ],
      instalments: [
        { due_date: '2026-11-20', amount: '600.00', paid: true, paid_on: '2026-11-18' },
        { due_date: '2026-12-05', amount: '600.00', paid: false },
      ],
      issue_date: '2026-11-05',
      due_date: '2026-12-05',
      currency: 'CHF',
      total: '1200.00',
      paid_amount: '200.00',
      paid_on: '',
    },
    issues: { client_id: 'No client matches. Import the client first or pick one.' },
    ...over,
  })

const reading = (): ImportBatch =>
  batch({
    kind: 'auto',
    status: 'extracting',
    files: [
      file({ id: 'imf_inv', name: 'invoice-1001.pdf', document_type: 'sales_invoice' }),
      file({ id: 'imf_2', name: 'invoice-1002.pdf', status: 'extracting', chunks_total: null }),
      file({ id: 'imf_3', name: 'scan.png', status: 'queued', chunks_total: null }),
      file({ id: 'imf_4', name: 'broken.pdf', status: 'failed', error: 'Could not be read.' }),
    ],
    records: [
      invoiceRecord('imr_inv1'),
      invoiceRecord('imr_inv2', { data: { number: 'RE-1002' } }),
    ],
  })

const autoBatches = http.get('/api/v1/imports', () =>
  HttpResponse.json({ data: [summary({ kind: 'auto' })] }),
)

/** Each document's rows appear as soon as its file is read; the others keep their own state chip. */
export const ReviewWhileReading: Story = {
  parameters: { msw: { handlers: [sessionHandler(), autoBatches, getBatch(reading)] } },
  render: () => <ImportDrawer kind="auto" onClose={() => {}} />,
  play: async () => {
    await opened('Import documents')
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    const document = await body().findByRole('region', { name: 'invoice-1001.pdf' })
    await expect(within(document).getByText('RE-1001')).toBeVisible()
    const list = body().getByRole('list', { name: 'Files' })
    const states = within(list)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-status'))
    await expect(states).toEqual(['done', 'extracting', 'queued', 'failed'])
    await expect(body().getByText('2 rows need a client')).toBeVisible()
    await expect(body().getByRole('button', { name: 'Choose a client for all' })).toBeVisible()
    await expect(body().getByText('Read 2 of 4 files…')).toBeVisible()
    await expect(body().getByRole('button', { name: /^Import/ })).toBeDisabled()
  },
}

/** The edit drawer stacks over the import one; dates and amounts use the same fields as the invoice editor. */
export const EditInvoiceDrawer: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        autoBatches,
        getBatch(() => ({ ...reading(), status: 'review' })),
        ...editorApi([]),
      ],
    },
  },
  render: () => <ImportDrawer kind="auto" onClose={() => {}} />,
  play: async () => {
    await opened('Import documents')
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    await userEvent.click(await body().findByRole('button', { name: 'Edit RE-1001' }))
    const editor = await body().findByRole('dialog', { name: 'Edit record' })
    await expect(within(editor).getByRole('button', { name: /^Invoice date: / })).toBeVisible()
    await expect(within(editor).getByRole('button', { name: /^Due date: / })).toBeVisible()
    await expect(
      within(editor).getByRole('button', { name: 'Paid on: Choose a date' }),
    ).toBeVisible()
    // One currency per record, changeable beside each amount.
    await expect(within(editor).getAllByRole('button', { name: /Currency.*CHF/ })).toHaveLength(2)
    // Amounts read as money until focused.
    await expect(within(editor).getByRole('textbox', { name: /Total amount/ })).toHaveValue(
      '1’200.00',
    )
    await expect(within(editor).getByRole('textbox', { name: /Already paid/ })).toHaveValue(
      '200.00',
    )
    // The document's client, not yet a client here, with what was found about it.
    await expect(
      within(editor).getByRole('region', { name: 'Found on the document' }),
    ).toBeVisible()
    await expect(within(editor).getByText(/Fix 1 thing before importing/)).toBeVisible()
    // The invoice as the invoice editor shows one: its lines, totals from the server and its instalments.
    const lines = within(editor).getByRole('region', { name: 'Lines' })
    await expect(within(lines).getByDisplayValue('Website care')).toBeVisible()
    await expect(await within(lines).findByText('Net')).toBeVisible()
    const instalments = within(editor).getByRole('list', { name: 'Instalments' })
    await expect(within(instalments).getAllByRole('listitem')).toHaveLength(2)
    await expect(
      within(instalments).getByRole('switch', { name: 'Instalment 1 · Paid' }),
    ).toBeChecked()
    await userEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(body().queryByRole('dialog', { name: 'Edit record' })).toBeNull())
    await expect(body().getByRole('dialog', { name: 'Import documents' })).toBeVisible()
  },
}
