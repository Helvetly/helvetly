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
  name: 'Melanie Vala',
  city: 'Cham',
  country: 'CH',
})
const invoice = record('imr_invoice', 'invoices', {
  client_name: 'Melanie Vala',
  number: '2025/IN/001',
  issue_date: '2025-01-08',
  currency: 'CHF',
  total: '2218.50',
  issued_elsewhere: true,
})
const repeated = record(
  'imr_repeat',
  'invoices',
  { client_name: 'Erin Henner', number: '2025/IN/004', currency: 'CHF', total: '352.80' },
  {
    file_id: 'imf_2',
    duplicate: { id: 'inv_4', label: '2025/IN/004 · Erin Henner', reason: 'number already used' },
  },
)
const engagement = record('imr_engagement', 'engagements', {
  client_name: 'Melanie Vala',
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
    await expect(body().getByRole('region', { name: '2025-IN-004.pdf' })).toBeVisible()
    // The file's card names its type once.
    await expect(body().getAllByText(/Invoice you issued/)).toHaveLength(2)
    await expect(body().getByText(/does not look like an invoice/)).toBeVisible()
    await expect(
      body().getByText(/Found 1 client, 2 invoices and 1 engagement · 3 selected/),
    ).toBeVisible()
    await expect(body().getByRole('checkbox', { name: 'Select 2025/IN/004' })).not.toBeChecked()

    // Unticking every invoice keeps the clients and the engagement ticked.
    const [, invoices] = within(first).getAllByRole('table')
    const selectAll = within(invoices!).getByRole('checkbox', { name: 'Select all' })
    await userEvent.click(selectAll)
    await expect(body().getByRole('checkbox', { name: 'Select Melanie Vala' })).toBeChecked()
    await expect(body().getByText(/· 2 selected/)).toBeVisible()

    await userEvent.click(body().getByRole('button', { name: 'Import 2' }))
    await waitFor(() => expect(committed).toEqual(['imr_client', 'imr_engagement']))
    await expect(await body().findByText('2 created')).toBeVisible()

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
    await expect(
      body().getByText(/Possible duplicate of 2025\/IN\/004 · Erin Henner/),
    ).toBeVisible()
    await expect(body().getByText('Melanie Vala · 2025-01-08 · CHF 2218.50')).toBeVisible()
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
