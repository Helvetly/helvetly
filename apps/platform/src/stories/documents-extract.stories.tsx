import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { DocumentsPage } from '@/components/documents/documents-page'
import { Preview } from '@/components/documents/preview'
import type { DocFile, Folder } from '@/lib/documents'
import type { ImportBatch, ImportRecord } from '@/lib/imports'

import { emptyPage, screenHandlers, storySession } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Extract documents with AI',
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/documents' } } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

const doc = (id: string, name: string, content_type: string): DocFile => ({
  id,
  name,
  folder_id: null,
  folder: null,
  size: 48_000,
  content_type,
  kind: content_type === 'application/pdf' ? 'pdf' : 'other',
  sha256: '0'.repeat(64),
  tags: [],
  ai_filing: null,
  previewable: false,
  links: [],
  retained_until: null,
  uploaded_by: storySession.user,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
})
const invoicePdf = doc('doc_inv', '2025-IN-001.pdf', 'application/pdf')
const contractPdf = doc('doc_con', 'Service agreement.pdf', 'application/pdf')
const keynote = doc('doc_key', 'Pitch.key', 'application/octet-stream')
const contracts: Folder = {
  id: 'fld_c',
  name: 'Contracts',
  parent_id: null,
  file_count: 0,
  size: 0,
  total_files: 0,
  total_size: 0,
  starred: false,
  created_by: null,
  created_at: '2026-01-05T09:00:00Z',
  updated_at: '2026-01-05T09:00:00Z',
}

const record = (id: string, kind: ImportRecord['kind'], data: ImportRecord['data']) => ({
  id,
  file_id: 'imf_1',
  kind,
  status: 'pending' as const,
  data,
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
})
const review: ImportBatch = {
  id: 'imp_docs',
  kind: 'auto',
  status: 'review',
  created_at: '2026-11-19T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: invoicePdf.name,
      size: invoicePdf.size,
      content_type: 'application/pdf',
      status: 'done',
      error: null,
      chunks_done: 1,
      chunks_total: 1,
      reused: true,
      document_type: 'sales_invoice',
    },
  ],
  records: [
    record('imr_client', 'clients', { name: 'Anna Beispiel', city: 'Cham', country: 'CH' }),
    record('imr_invoice', 'invoices', {
      client_name: 'Anna Beispiel',
      number: '2025/IN/001',
      issue_date: '2025-01-08',
      currency: 'CHF',
      total: '828.00',
    }),
  ],
}

let started: string[][] = []
const page = (
  start: Parameters<typeof http.post>[1],
  billing = billingFixture({ plan: 'business', status: 'active', interval: 'month' }),
) => [
  http.get('/api/v1/documents/folders', () => HttpResponse.json({ data: [contracts] })),
  http.get('/api/v1/documents', () =>
    HttpResponse.json({
      ...emptyPage,
      data: [invoicePdf, contractPdf, keynote],
      meta: { ...emptyPage.meta, total: 3, total_pages: 1 },
    }),
  ),
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  http.get('/api/v1/imports', () => HttpResponse.json({ data: [] })),
  http.post('/api/v1/imports/documents', start),
  http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: review })),
  ...screenHandlers,
]
const recordStart: Parameters<typeof http.post>[1] = async ({ request }) => {
  const sent: unknown = await request.json()
  if (
    typeof sent === 'object' &&
    sent &&
    'document_ids' in sent &&
    Array.isArray(sent.document_ids)
  )
    started.push(sent.document_ids.map(String))
  return HttpResponse.json({ data: review }, { status: 201 })
}

const select = async (name: string) => {
  await userEvent.click(await body().findByRole('checkbox', { name: `Select ${name}` }))
  return within(body().getByRole('toolbar', { name: 'Selected rows' }))
}

/** Two files chosen: one click reads both and the drawer opens on what was found, nothing saved yet. */
export const FromSelection: Story = {
  beforeEach: () => {
    started = []
  },
  parameters: { msw: { handlers: page(recordStart) } },
  render: () => <DocumentsPage />,
  play: async () => {
    await select(invoicePdf.name)
    const bar = await select(contractPdf.name)
    await userEvent.click(bar.getByRole('button', { name: 'Extract with AI' }))
    await waitFor(() => expect(started).toEqual([['doc_inv', 'doc_con']]))
    const drawer = within(await body().findByRole('dialog', { name: 'Import documents' }))
    await expect((await drawer.findAllByText('Anna Beispiel'))[0]).toBeVisible()
    await expect(drawer.getByRole('button', { name: /^Import 2/ })).toBeEnabled()
  },
}

/** Folders and files the AI cannot read keep the action, disabled, with the reason in its tooltip. */
export const DisabledReasons: Story = {
  beforeEach: () => {
    started = []
  },
  parameters: { msw: { handlers: page(recordStart) } },
  render: () => <DocumentsPage />,
  play: async () => {
    let bar = await select(keynote.name)
    const action = bar.getByRole('button', { name: 'Extract with AI' })
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(action)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(/The AI reads PDF/)
    await userEvent.click(action)
    await userEvent.click(body().getByRole('button', { name: 'Clear selection' }))

    bar = await select(contracts.name)
    const forFolder = bar.getByRole('button', { name: 'Extract with AI' })
    await userEvent.hover(forFolder)
    await waitFor(() =>
      expect(body().getByRole('tooltip')).toHaveTextContent('Choose files, not folders.'),
    )
    await expect(started).toEqual([])
    await expect(body().queryByRole('dialog')).toBeNull()
    await userEvent.click(body().getByRole('button', { name: 'Clear selection' }))
  },
}

/** On a plan without AI import the action names the plan's reason instead. */
export const PlanLacksIt: Story = {
  parameters: {
    msw: { handlers: page(recordStart, billingFixture({ plan: 'basic', status: 'active' })) },
  },
  render: () => <DocumentsPage />,
  play: async () => {
    const bar = await select(invoicePdf.name)
    const action = bar.getByRole('button', { name: 'Extract with AI' })
    await waitFor(() => expect(action).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.hover(action)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(/plan/)
  },
}

/** While the import starts the drawer says so and cannot be closed. */
export const Starting: Story = {
  parameters: {
    msw: {
      handlers: page(async () => {
        await delay('infinite')
        return HttpResponse.json({ data: review }, { status: 201 })
      }),
    },
  },
  render: () => <DocumentsPage />,
  play: async () => {
    const bar = await select(invoicePdf.name)
    await userEvent.click(bar.getByRole('button', { name: 'Extract with AI' }))
    await expect(await body().findByRole('button', { name: 'Starting…' })).toBeDisabled()
    await expect(body().getByRole('button', { name: 'Close' })).toBeDisabled()
  },
}

/** The server refuses (no AI model here): the drawer shows why, and nothing was read. */
export const StartFails: Story = {
  parameters: {
    msw: {
      handlers: page(() =>
        HttpResponse.json(
          {
            error: {
              code: 'ai_not_configured',
              message:
                "This server has no AI model configured, so files can't be read automatically.",
            },
          },
          { status: 409 },
        ),
      ),
    },
  },
  render: () => <DocumentsPage />,
  play: async () => {
    const bar = await select(invoicePdf.name)
    await userEvent.click(bar.getByRole('button', { name: 'Extract with AI' }))
    await expect(await body().findByRole('alert')).toHaveTextContent(/no AI model configured/)
  },
}

const extract = fn()
const previewCommands = {
  rename: fn(),
  move: fn(),
  copy: fn(),
  trash: fn(),
  restore: fn(),
  link: fn(),
  unlink: fn(),
  openFolder: fn(),
  sign: fn(),
  extract,
}

/** The preview's header starts it for the open file. */
export const FromPreview: Story = {
  beforeEach: () => {
    extract.mockClear()
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_inv', () => HttpResponse.json({ data: invoicePdf })),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <Preview
      id="doc_inv"
      siblings={[]}
      commands={previewCommands}
      onNavigate={fn()}
      onClose={fn()}
    />
  ),
  play: async () => {
    await body().findByText(invoicePdf.name)
    await userEvent.click(body().getByRole('button', { name: 'Extract with AI' }))
    await expect(extract).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc_inv' }))
  },
}

/** A file the AI cannot read: the button stays, disabled, and says why. */
export const FromPreviewUnsupported: Story = {
  beforeEach: () => {
    extract.mockClear()
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_key', () => HttpResponse.json({ data: keynote })),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <Preview
      id="doc_key"
      siblings={[]}
      commands={previewCommands}
      onNavigate={fn()}
      onClose={fn()}
    />
  ),
  play: async () => {
    await body().findByText(keynote.name)
    const action = body().getByRole('button', { name: 'Extract with AI' })
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(action)
    await expect(extract).not.toHaveBeenCalled()
  },
}
