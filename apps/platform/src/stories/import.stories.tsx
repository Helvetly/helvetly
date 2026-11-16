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

import { billingFixture } from '@/components/billing/billing-fixture'
import { dropdownKit } from '@/components/data/menus'
import { ImportItem } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import type { ImportBatch, ImportFile, ImportRecord, ImportSummary } from '@/lib/imports'

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

/** Chooses one spreadsheet in the drop zone and presses "Read files". */
async function chooseAndRead() {
  await opened()
  const input = await body().findByLabelText('Choose files to import')
  await userEvent.upload(input, new File(['name;email\nMuster AG;info@muster.ch'], 'clients.csv'))
  await expect(body().getByText('clients.csv')).toBeVisible()
  await userEvent.click(body().getByRole('button', { name: 'Read files' }))
}

/** Opens the unfinished batch the drawer offers. */
async function continueImport() {
  await waitFor(() => expect(body().getByRole('dialog')).toBeVisible())
  await userEvent.click(await body().findByRole('button', { name: /^Continue the import from/ }))
  await body().findByRole('table', { name: 'Records found' })
}

/** The first visit: a drop zone that explains itself; nothing to read yet. */
export const Empty: Story = {
  parameters: { msw: { handlers: [sessionHandler(), noBatches] } },
  play: async () => {
    await opened()
    await expect(body().getByText(/nothing is created until you choose rows/)).toBeVisible()
    await expect(body().getByText(/Up to 10 files of 25 MB each/)).toBeVisible()
    await expect(body().getByRole('button', { name: 'Read files' })).toBeDisabled()
    await expect(body().queryByRole('button', { name: /^Continue the import/ })).toBeNull()
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
    await expect(body().getByText('Enter a valid email address.')).toBeVisible()
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
    const email = await body().findByRole('textbox', { name: 'Email' })
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await userEvent.clear(email)
    await userEvent.type(email, 'info@beta.ch')
    await userEvent.click(body().getByRole('button', { name: 'Save' }))
    await body().findByRole('table', { name: 'Records found' })
    await expect(body().queryByText('Enter a valid email address.')).toBeNull()
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

let consented = false
/** No AI consent yet: an owner can allow it right here, and the upload goes through. */
export const ConsentMissing: Story = {
  beforeEach: () => {
    consented = false
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'owner' }),
        noBatches,
        http.post('/api/v1/imports', () =>
          consented
            ? HttpResponse.json({ data: extracting }, { status: 201 })
            : fail(403, 'ai_consent_required', 'AI consent is required.'),
        ),
        http.put('/api/v1/heidi/consent', () => {
          consented = true
          return HttpResponse.json({
            data: { granted: true, changed_at: '2026-11-09T10:00:00Z', changed_by: 'Anna' },
          })
        }),
        getBatch(() => extracting),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(await body().findByText('AI reading is not allowed yet')).toBeVisible()
    // The button waits for the session (owners and admins only), which can settle after the error.
    await userEvent.click(await body().findByRole('button', { name: 'Allow OpenAI' }))
    await expect(await body().findByText('Reading part 2 of 5')).toBeVisible()
  },
}

/** A member without the right to allow it is told whom to ask. */
export const ConsentMissingMember: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member' }),
        noBatches,
        http.post('/api/v1/imports', () =>
          fail(403, 'ai_consent_required', 'AI consent is required.'),
        ),
      ],
    },
  },
  play: async () => {
    await chooseAndRead()
    await expect(await body().findByText('Ask an owner or admin of this workspace.')).toBeVisible()
    await expect(body().queryByRole('button', { name: 'Allow OpenAI' })).toBeNull()
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
    await expect(body().getByText('Enter a price like 49.90.')).toBeVisible()
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
    await expect(body().getByRole('button', { name: 'Read files' })).toBeDisabled()
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
