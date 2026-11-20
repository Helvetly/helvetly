import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ImportCard } from '@/components/heidi/import-card'
import { ImportDrawer } from '@/components/import/import-drawer'
import type { CommitResult, ImportBatch, ImportFile, ImportRecord } from '@/lib/imports'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import documents',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const file = (id: string, name: string, over: Partial<ImportFile> = {}): ImportFile => ({
  id,
  name,
  size: 60_000,
  content_type: 'application/pdf',
  status: 'done',
  error: null,
  chunks_done: 1,
  chunks_total: 1,
  reused: false,
  document_type: 'sales_invoice',
  ...over,
})

const record = (
  id: string,
  kind: ImportRecord['kind'],
  data: ImportRecord['data'],
  over: Partial<ImportRecord> = {},
): ImportRecord => ({
  id,
  file_id: 'imf_1',
  kind,
  status: 'pending',
  data,
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
  ...over,
})

const client = record('imr_client', 'clients', {
  name: 'Anna Beispiel',
  city: 'Cham',
  country: 'CH',
})
const invoice = record('imr_invoice', 'invoices', {
  client_name: 'Anna Beispiel',
  number: '2025/IN/001',
  issue_date: '2025-01-08',
  currency: 'CHF',
  total: '2218.50',
  issued_elsewhere: true,
})
const repeated = record(
  'imr_repeat',
  'invoices',
  { client_name: 'Max Muster', number: '2025/IN/004', currency: 'CHF', total: '352.80' },
  {
    file_id: 'imf_2',
    duplicate: { id: 'inv_4', label: '2025/IN/004 · Max Muster', reason: 'number already used' },
  },
)
const engagement = record('imr_engagement', 'engagements', {
  client_name: 'Anna Beispiel',
  title: 'German A1.2 private tuition',
  start_date: '2025-02-08',
})

const batch = (records: ImportRecord[]): ImportBatch => ({
  id: 'imp_auto',
  kind: 'auto',
  status: 'review',
  created_at: '2026-11-15T09:30:00Z',
  files: [
    file('imf_1', 'invoices.zip › 2025-IN-001.pdf'),
    file('imf_2', '2025-IN-004.pdf'),
    file('imf_3', '2025-CON-1-001.pdf', { document_type: 'contract' }),
    file('imf_4', 'scan.pdf', {
      status: 'failed',
      document_type: 'other',
      error:
        'This file does not look like an invoice, bill, contract, client list or price list, so nothing was taken from it.',
    }),
  ],
  records,
})

const body = () => within(document.body)

let current = batch([])
let committed: string[] = []
const handlers = () => [
  sessionHandler(),
  http.get('/api/v1/imports', () =>
    HttpResponse.json({
      data: [
        {
          id: 'imp_auto',
          kind: 'auto',
          status: 'review',
          created_at: '2026-11-15T09:30:00Z',
          pending: 4,
        },
      ],
    }),
  ),
  http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: current })),
  http.post<{ id: string }, { record_ids: string[] }>(
    '/api/v1/imports/:id/commit',
    async ({ request }) => {
      committed = (await request.json()).record_ids
      const created = (r: ImportRecord): ImportRecord =>
        committed.includes(r.id) ? { ...r, status: 'created', entity_id: `ent_${r.id}` } : r
      current = { ...current, records: current.records.map(created) }
      const results: CommitResult[] = committed.map((id) => ({
        id,
        status: 'created',
        entity_id: `ent_${id}`,
        error: null,
        conflict: null,
      }))
      return HttpResponse.json({ data: { results, batch: current } })
    },
  ),
]
const setUp = () => {
  current = batch([client, invoice, repeated, engagement])
  committed = []
}

/** Files of several kinds in one import: what each file is, the records under their kind, duplicates left unticked. */
export const Drawer: Story = {
  render: () => <ImportDrawer kind="auto" onClose={() => {}} />,
  beforeEach: setUp,
  parameters: { msw: { handlers: handlers() } },
  play: async () => {
    await waitFor(() => expect(body().getByRole('dialog')).toBeVisible())
    await expect(body().getByText('Import documents')).toBeVisible()
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    // One section per document, its records beneath.
    const first = await body().findByRole('region', { name: 'invoices.zip › 2025-IN-001.pdf' })
    await expect(first).toBeVisible()
    // A file whose one record is already in Helvetly says so and starts closed.
    const known = body().getByRole('button', { name: /2025-IN-004\.pdf/ })
    await expect(known).toHaveTextContent('Already in Helvetly')
    await expect(known).toHaveAttribute('aria-expanded', 'false')
    // Each kind in a file is a group of its own, headed by its name and count, the client before its invoice.
    const groups = within(first).getAllByRole('group')
    await expect(groups.map((group) => group.getAttribute('aria-labelledby'))).toEqual([
      'imf_1-clients',
      'imf_1-invoices',
      'imf_1-engagements',
    ])
    await expect(within(groups[0]!).getByRole('heading', { name: /^Clients\s*1$/ })).toBeVisible()
    await expect(within(first).getAllByRole('columnheader', { name: 'Name' })[0]).toHaveClass(
      'font-medium',
    )
    // The file's card names its type once.
    await expect(body().getAllByText(/Invoice you issued/)).toHaveLength(2)
    await expect(body().getByText(/does not look like an invoice/)).toBeVisible()
    await expect(
      body().getByText(/Found 1 client, 2 invoices and 1 engagement · 3 selected/),
    ).toBeVisible()

    // Unticking every invoice keeps the clients and the engagement ticked.
    const [, invoices] = within(first).getAllByRole('table')
    const selectAll = within(invoices!).getByRole('checkbox', { name: 'Select all' })
    await userEvent.click(selectAll)
    await expect(body().getByRole('checkbox', { name: 'Select Anna Beispiel' })).toBeChecked()
    await expect(body().getByText(/· 2 selected/)).toBeVisible()

    await userEvent.click(body().getByRole('button', { name: 'Import 2' }))
    await waitFor(() => expect(committed).toEqual(['imr_client', 'imr_engagement']))
    await expect(await body().findByText('2 created')).toBeVisible()

    // One file open at a time: opening the known one closes the first.
    await userEvent.click(known)
    await expect(body().getByRole('region', { name: '2025-IN-004.pdf' })).toBeVisible()
    await expect(
      body().getByRole('button', { name: /invoices\.zip › 2025-IN-001\.pdf/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(body().getByRole('checkbox', { name: 'Select 2025/IN/004' })).not.toBeChecked()

    // One tick at the top selects the rows still open in every file.
    await userEvent.click(body().getByRole('checkbox', { name: 'Select all rows' }))
    await expect(body().getByRole('checkbox', { name: 'Select 2025/IN/004' })).toBeChecked()
    await expect(body().getByText('2 of 2 rows selected, in all files')).toBeVisible()
  },
}

/** Heidi's answer follows the import in the chat: file types, what was found, warnings, and Import right there. */
export const InChat: Story = {
  render: () => (
    <div className="max-w-[420px] p-4">
      <ImportCard batchId="imp_auto" />
    </div>
  ),
  beforeEach: setUp,
  parameters: { msw: { handlers: handlers() } },
  play: async () => {
    await expect(
      await body().findByText('Found 1 client, 2 invoices and 1 engagement.'),
    ).toBeVisible()
    await expect(body().getByText('Contract')).toBeVisible()
    await expect(body().getByText(/Possible duplicate of 2025\/IN\/004 · Max Muster/)).toBeVisible()
    await expect(body().getByText('Anna Beispiel · 2025-01-08 · CHF 2218.50')).toBeVisible()
    await expect(body().getByRole('checkbox', { name: 'Import 2025/IN/004' })).not.toBeChecked()
    await expect(body().getByRole('link', { name: 'Review and edit' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/?\?import=1$/),
    )

    await userEvent.click(body().getByRole('button', { name: 'Import 3' }))
    await waitFor(() => expect(committed).toEqual(['imr_client', 'imr_invoice', 'imr_engagement']))
    await expect(await body().findByText('3 created')).toBeVisible()
    await expect(body().getByRole('link', { name: '2025/IN/001' })).toHaveAttribute(
      'href',
      expect.stringContaining('ent_imr_invoice'),
    )
  },
}

// The same invoice imported again: its client and the invoice, each matched to what Helvetly already has.
const knownClient = record(
  'imr_known_client',
  'clients',
  { name: 'Shuchi Kumra', city: 'Zürich', country: 'CH' },
  {
    file_id: 'imf_again',
    status: 'skipped',
    duplicate: { id: 'cli_shuchi', label: 'Shuchi Kumra', reason: 'same name' },
  },
)
const knownInvoice = record(
  'imr_known_invoice',
  'invoices',
  {
    client_name: 'Shuchi Kumra',
    number: '2026/IN/012',
    issue_date: '2026-03-02',
    currency: 'CHF',
    total: '1200.00',
    issued_elsewhere: true,
  },
  {
    file_id: 'imf_again',
    duplicate: { id: 'inv_12', label: '2026/IN/012 · Shuchi Kumra', reason: 'number already used' },
  },
)
const newClient = record(
  'imr_new_client',
  'clients',
  { name: 'Lea Neu', city: 'Bern', country: 'CH' },
  { file_id: 'imf_new' },
)
const newInvoice = record(
  'imr_new_invoice',
  'invoices',
  { client_name: 'Lea Neu', number: '2026/IN/013', currency: 'CHF', total: '480.00' },
  { file_id: 'imf_new' },
)

const reimport = (files: ImportFile[], records: ImportRecord[]) => () => {
  current = { ...batch(records), files }
  committed = []
}

/** A file imported again: the same records as the first time, each matched; the file says so and starts closed. */
export const ReImportAllMatched: Story = {
  render: () => <ImportDrawer kind="auto" onClose={() => {}} />,
  beforeEach: reimport(
    [file('imf_again', '2026-IN-012.pdf', { reused: true })],
    [knownClient, knownInvoice],
  ),
  parameters: { msw: { handlers: handlers() } },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    const toggle = await body().findByRole('button', { name: /2026-IN-012\.pdf/ })
    await expect(toggle).toHaveTextContent('All 2 records already in Helvetly')
    await expect(toggle).toHaveTextContent('already in Documents')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(body().getByRole('button', { name: 'Import 0' })).toBeDisabled()

    await userEvent.click(toggle)
    const found = body().getByRole('region', { name: '2026-IN-012.pdf' })
    await expect(within(found).getByText('Matches Shuchi Kumra in Helvetly')).toBeVisible()
    await expect(within(found).getByText('same name · linked, not created again')).toBeVisible()
    await expect(
      within(found).getByText('Already in Helvetly: 2026/IN/012 · Shuchi Kumra'),
    ).toBeVisible()
    await expect(
      within(found).getByText('number already used · tick to import anyway'),
    ).toBeVisible()
    const [clientLink, invoiceLink] = within(found).getAllByRole('link', { name: 'Open' })
    await expect(clientLink).toHaveAttribute('href', expect.stringContaining('cli_shuchi'))
    await expect(invoiceLink).toHaveAttribute('href', expect.stringContaining('inv_12'))
    // The linked client has nothing to choose; the invoice is left out unless ticked.
    await expect(within(found).queryByRole('checkbox', { name: 'Select Shuchi Kumra' })).toBeNull()
    const invoiceBox = within(found).getByRole('checkbox', { name: 'Select 2026/IN/012' })
    await expect(invoiceBox).not.toBeChecked()
    await userEvent.click(invoiceBox)
    await expect(within(found).getByText('number already used')).toBeVisible()
    await expect(body().getByRole('button', { name: 'Import 1' })).toBeEnabled()
  },
}

/** A new file beside one already imported: only the new one opens and is ticked. */
export const ReImportMixed: Story = {
  render: () => <ImportDrawer kind="auto" onClose={() => {}} />,
  beforeEach: reimport(
    [file('imf_again', '2026-IN-012.pdf'), file('imf_new', '2026-IN-013.pdf')],
    [knownClient, knownInvoice, newClient, newInvoice],
  ),
  parameters: { msw: { handlers: handlers() } },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    const again = await body().findByRole('button', { name: /2026-IN-012\.pdf/ })
    const fresh = body().getByRole('button', { name: /2026-IN-013\.pdf/ })
    await expect(again).toHaveAttribute('aria-expanded', 'false')
    await expect(fresh).toHaveAttribute('aria-expanded', 'true')
    await expect(fresh).toHaveTextContent('2 records found')
    await expect(body().getByRole('checkbox', { name: 'Select Lea Neu' })).toBeChecked()
    await expect(body().getByRole('checkbox', { name: 'Select 2026/IN/013' })).toBeChecked()

    await userEvent.click(body().getByRole('button', { name: 'Import 2' }))
    await waitFor(() => expect(committed).toEqual(['imr_new_client', 'imr_new_invoice']))
  },
}

/** The file with problems opens first; opening another closes it: one file open at a time. */
export const ProblemFileFirst: Story = {
  render: () => <ImportDrawer kind="auto" onClose={() => {}} />,
  beforeEach: reimport(
    [file('imf_new', '2026-IN-013.pdf'), file('imf_bad', '2026-IN-014.pdf')],
    [
      newClient,
      newInvoice,
      record(
        'imr_bad_invoice',
        'invoices',
        { client_name: 'Lea Neu', number: '', currency: 'CHF', total: '90.00' },
        { file_id: 'imf_bad', issues: { number: 'The invoice number is missing.' } },
      ),
    ],
  ),
  parameters: { msw: { handlers: handlers() } },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    const clean = await body().findByRole('button', { name: /2026-IN-013\.pdf/ })
    const bad = body().getByRole('button', { name: /2026-IN-014\.pdf/ })
    await expect(bad).toHaveAttribute('aria-expanded', 'true')
    await expect(clean).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(clean)
    await expect(clean).toHaveAttribute('aria-expanded', 'true')
    await expect(bad).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(clean)
    await expect(clean).toHaveAttribute('aria-expanded', 'false')
    await expect(bad).toHaveAttribute('aria-expanded', 'false')
  },
}
