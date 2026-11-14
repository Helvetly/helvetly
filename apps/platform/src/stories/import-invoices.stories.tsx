import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ImportDrawer } from '@/components/import/import-drawer'
import type { CommitResult, ImportBatch, ImportRecord } from '@/lib/imports'
import { sampleClient } from '@/test/invoice-fixtures'

import { emptyPage, sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import invoices',
  parameters: { layout: 'fullscreen' },
  render: () => <ImportDrawer kind="invoices" onClose={() => {}} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const unmatched: ImportRecord = {
  id: 'imr_inv',
  file_id: 'imf_1',
  status: 'pending',
  data: {
    client_name: 'Alpenglow Studio',
    number: 'RE-2025-017',
    issue_date: '2025-10-01',
    currency: 'CHF',
    total: '1081.00',
    lines: [{ description: 'Beratung', quantity: '8', unit_price: '125.00', vat_rate: '8.1' }],
  },
  issues: { client_id: 'No client matches. Import the client first or pick one.' },
  duplicate: null,
  entity_id: null,
  error: null,
}

const batch = (records: ImportRecord[]): ImportBatch => ({
  id: 'imp_invoices',
  kind: 'invoices',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'RE-2025-017.pdf',
      size: 84_000,
      status: 'done',
      error: null,
      chunks_done: 1,
      chunks_total: 1,
      reused: false,
    },
  ],
  records,
})

const body = () => within(document.body)

let current = batch([unmatched])
let patched: Record<string, string | null> = {}
/** An invoice whose buyer is not a client yet: pick one in place, and the row is ready to import as a draft. */
export const PickClient: Story = {
  beforeEach: () => {
    current = batch([unmatched])
    patched = {}
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/imports', () =>
          HttpResponse.json({
            data: [
              {
                id: 'imp_invoices',
                kind: 'invoices',
                status: 'review',
                created_at: '2026-11-08T09:30:00Z',
                pending: 1,
              },
            ],
          }),
        ),
        http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: current })),
        http.get('/api/v1/clients', () =>
          HttpResponse.json({
            ...emptyPage,
            data: [sampleClient()],
            meta: { ...emptyPage.meta, total: 1, total_pages: 1 },
          }),
        ),
        http.patch<{ id: string; record: string }, { data: Record<string, string | null> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            patched = (await request.json()).data
            const fixed: ImportRecord = {
              ...unmatched,
              data: { ...unmatched.data, client_id: patched.client_id ?? '' },
              issues: {},
            }
            current = batch([fixed])
            return HttpResponse.json({ data: fixed })
          },
        ),
      ],
    },
  },
  play: async () => {
    await waitFor(() => expect(body().getByRole('dialog')).toBeVisible())
    await userEvent.click(await body().findByRole('button', { name: /^Continue the import from/ }))
    await body().findByRole('table', { name: 'Records found' })
    await expect(body().getByText('1 line')).toBeVisible()
    await expect(body().getByText(/Client: No client matches/)).toBeVisible()
    await expect(body().getByRole('checkbox', { name: 'Select RE-2025-017' })).not.toBeChecked()

    await userEvent.click(body().getByRole('button', { name: 'Edit RE-2025-017' }))
    const picker = await body().findByRole('button', { name: 'Client' })
    await expect(picker).toHaveAttribute('aria-invalid', 'true')
    await userEvent.click(picker)
    await userEvent.click(await body().findByRole('option', { name: /Alpenglow Studio GmbH/ }))
    await expect(body().getByRole('button', { name: 'Client' })).toHaveTextContent(
      'Alpenglow Studio GmbH',
    )
    await userEvent.click(body().getByRole('button', { name: 'Save' }))

    await body().findByRole('table', { name: 'Records found' })
    await expect(patched).toEqual({ client_id: 'cli_1', client_name: 'Alpenglow Studio GmbH' })
    await expect(body().queryByText(/Client: No client matches/)).toBeNull()
    await expect(body().getByRole('checkbox', { name: 'Select RE-2025-017' })).toBeChecked()
    await expect(body().getByRole('button', { name: 'Import 1' })).toBeEnabled()
  },
}

// ---- invoices issued elsewhere: number conflicts and the issued toggle ----

const issued = (n: number, client = 'Kunde AG'): ImportRecord => ({
  id: `imr_${n}`,
  file_id: 'imf_1',
  status: 'pending',
  data: {
    client_id: 'cli_1',
    client_name: client,
    number: `ALT-${n}`,
    issue_date: '2025-10-01',
    currency: 'CHF',
    total: '1081.00',
    issued_elsewhere: true,
    lines: [{ description: 'Beratung', quantity: '8', unit_price: '125.00', vat_rate: '8.1' }],
  },
  issues: {},
  duplicate: { id: `inv_${n}`, label: `ALT-${n} · ${client}`, reason: 'number already used' },
  entity_id: null,
  error: null,
})

const conflictOf = (record: ImportRecord, whyNot: string | null): CommitResult => ({
  id: record.id,
  status: 'conflict',
  entity_id: null,
  error: null,
  conflict: {
    id: `inv_${record.id.slice(4)}`,
    label: `${String(record.data.number)} · ${String(record.data.client_name)}`,
    reason: 'number already used',
    can_overwrite: whyNot === null,
    why_not: whyNot,
  },
})

const HELVETLY_ISSUED =
  'It was issued in Helvetly and cannot be changed. Skip this row; to correct that invoice, issue a credit note.'

let commits: { record_ids: string[]; resolutions: Record<string, string> }[] = []

/** The import API for a batch of conflicting records: the first commit reports conflicts, a commit with resolutions
 * overwrites (created, the existing invoice's id) or skips. */
const conflictHandlers = (records: ImportRecord[], whyNot: Record<string, string>) => {
  let state = batch(records)
  return [
    sessionHandler(),
    http.get('/api/v1/imports', () =>
      HttpResponse.json({
        data: [
          {
            id: 'imp_invoices',
            kind: 'invoices',
            status: 'review',
            created_at: '2026-11-08T09:30:00Z',
            pending: records.length,
          },
        ],
      }),
    ),
    http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: state })),
    http.post<{ id: string }, { record_ids: string[]; resolutions: Record<string, string> }>(
      '/api/v1/imports/:id/commit',
      async ({ request }) => {
        const sent = await request.json()
        commits.push(sent)
        const results = sent.record_ids.map((id): CommitResult => {
          const record = state.records.find((entry) => entry.id === id) ?? issued(0)
          const choice = sent.resolutions[id]
          if (!choice) return conflictOf(record, whyNot[id] ?? null)
          const created = choice === 'overwrite'
          return {
            id,
            status: created ? 'created' : 'skipped',
            entity_id: created ? `inv_${id.slice(4)}` : null,
            error: null,
            conflict: null,
          }
        })
        state = batch(
          state.records.map((record): ImportRecord => {
            const result = results.find((entry) => entry.id === record.id)
            if (result?.status !== 'created' && result?.status !== 'skipped') return record
            return Object.assign({}, record, { status: result.status, entity_id: result.entity_id })
          }),
        )
        return HttpResponse.json({ data: { results, batch: state } })
      },
    ),
  ]
}

/** Opens the unfinished batch, ticks every row and imports: the conflicts dialog appears. */
const importAll = async (count: number) => {
  await waitFor(() => expect(body().getByRole('dialog')).toBeVisible())
  await userEvent.click(await body().findByRole('button', { name: /^Continue the import from/ }))
  await body().findByRole('table', { name: 'Records found' })
  await expect(body().getAllByText(/number already used/)).toHaveLength(count)
  await userEvent.click(body().getByRole('checkbox', { name: 'Select all' }))
  await userEvent.click(body().getByRole('button', { name: `Import ${count}` }))
  return body().findByRole('dialog', { name: /already used/ })
}

/** Two numbers already imported earlier: overwrite one, skip the other, confirm once. */
export const ConflictsOverwriteOrSkip: Story = {
  beforeEach: () => {
    commits = []
  },
  parameters: {
    msw: { handlers: conflictHandlers([issued(1), issued(2, 'Alpenglow Studio')], {}) },
  },
  play: async () => {
    const dialog = within(await importAll(2))
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: '2 numbers are already used' })).toBeVisible(),
    )
    await expect(dialog.getByRole('link', { name: 'ALT-1 · Kunde AG' })).toHaveAttribute(
      'href',
      expect.stringContaining('?id=inv_1'),
    )
    // Skip is the safe default for every row.
    await expect(dialog.getByRole('button', { name: 'Skip ALT-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Overwrite ALT-1' }))
    await expect(dialog.getByRole('button', { name: 'Overwrite ALT-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.getByRole('button', { name: 'Skip ALT-2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(body().queryByRole('dialog', { name: /already used/ })).toBeNull())
    await expect(commits[1]).toEqual({
      record_ids: ['imr_1', 'imr_2'],
      resolutions: { imr_1: 'overwrite', imr_2: 'skip' },
    })
    await expect(body().getByText('1 created, 1 skipped')).toBeVisible()
    await expect(body().getByText('Skipped')).toBeVisible()
  },
}

/** A number of an invoice issued in Helvetly: it cannot be overwritten, and the dialog says why. */
export const HelvetlyIssuedConflict: Story = {
  beforeEach: () => {
    commits = []
  },
  parameters: { msw: { handlers: conflictHandlers([issued(7)], { imr_7: HELVETLY_ISSUED }) } },
  play: async () => {
    const dialog = within(await importAll(1))
    await waitFor(() =>
      expect(dialog.getByRole('heading', { name: 'This number is already used' })).toBeVisible(),
    )
    await expect(dialog.getByRole('button', { name: 'Overwrite ALT-7' })).toBeDisabled()
    await expect(dialog.getByText(/issued in Helvetly and cannot be changed/)).toBeVisible()
    await expect(dialog.queryByRole('button', { name: 'Overwrite all' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(commits).toHaveLength(2))
    await expect(commits[1]?.resolutions).toEqual({ imr_7: 'skip' })
    await expect(await body().findByText('0 created, 1 skipped')).toBeVisible()
  },
}

/** Three conflicts: "Overwrite all" picks overwrite wherever it is allowed, "Skip all" turns every row back. */
export const ApplyToAll: Story = {
  beforeEach: () => {
    commits = []
  },
  parameters: {
    msw: {
      handlers: conflictHandlers([issued(1), issued(2), issued(3)], {
        imr_3: 'It already has payments recorded.',
      }),
    },
  },
  play: async () => {
    const dialog = within(await importAll(3))
    await userEvent.click(dialog.getByRole('button', { name: 'Overwrite all' }))
    await expect(dialog.getByRole('button', { name: 'Overwrite ALT-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.getByRole('button', { name: 'Overwrite ALT-2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.getByRole('button', { name: 'Skip ALT-3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The dialog fades in (opacity from 0): wait until the reason is shown.
    await waitFor(() => expect(dialog.getByText(/already has payments recorded/)).toBeVisible())
    await userEvent.click(dialog.getByRole('button', { name: 'Skip all' }))
    await expect(dialog.getByRole('button', { name: 'Skip ALT-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Overwrite all' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(commits).toHaveLength(2))
    await expect(commits[1]?.resolutions).toEqual({
      imr_1: 'overwrite',
      imr_2: 'overwrite',
      imr_3: 'skip',
    })
    await expect(await body().findByText('2 created, 1 skipped')).toBeVisible()
  },
}

let toggled: Record<string, string | boolean> = {}
const draftRecord: ImportRecord = {
  ...issued(5),
  data: { ...issued(5).data, issued_elsewhere: false },
  duplicate: null,
}

/** A finished invoice the model read as a draft: tick "Already issued" and add what was paid, in place. */
export const IssuedElsewhereToggle: Story = {
  beforeEach: () => {
    toggled = {}
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/imports', () =>
          HttpResponse.json({
            data: [
              {
                id: 'imp_invoices',
                kind: 'invoices',
                status: 'review',
                created_at: '2026-11-08T09:30:00Z',
                pending: 1,
              },
            ],
          }),
        ),
        http.get('/api/v1/imports/:id', () =>
          HttpResponse.json({
            data: batch([{ ...draftRecord, data: { ...draftRecord.data, ...toggled } }]),
          }),
        ),
        http.get('/api/v1/clients', () =>
          HttpResponse.json({ ...emptyPage, data: [sampleClient()] }),
        ),
        http.patch<{ id: string; record: string }, { data: Record<string, string | boolean> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            toggled = (await request.json()).data
            return HttpResponse.json({
              data: { ...draftRecord, data: { ...draftRecord.data, ...toggled } },
            })
          },
        ),
      ],
    },
  },
  play: async () => {
    await waitFor(() => expect(body().getByRole('dialog')).toBeVisible())
    await userEvent.click(await body().findByRole('button', { name: /^Continue the import from/ }))
    await body().findByRole('table', { name: 'Records found' })
    await expect(body().getByRole('columnheader', { name: 'Already issued' })).toBeVisible()
    await expect(body().queryByText('Already declared for VAT?')).not.toBeInTheDocument()
    await userEvent.click(body().getByRole('button', { name: 'Edit ALT-5' }))
    const toggle = await body().findByRole('checkbox', { name: 'Already issued' })
    await expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    await expect(toggle).toBeChecked()
    await userEvent.type(body().getByRole('textbox', { name: 'Already paid' }), '500.00')
    await userEvent.type(body().getByRole('textbox', { name: 'Paid on' }), '2025-10-15')
    await userEvent.click(body().getByRole('button', { name: 'Save' }))
    await body().findByRole('table', { name: 'Records found' })
    await expect(toggled).toEqual({
      issued_elsewhere: true,
      paid_amount: '500.00',
      paid_on: '2025-10-15',
    })
    // An invoice issued elsewhere counts in the VAT return: the note says how not to count it twice.
    await expect(await body().findByText('Already declared for VAT?')).toBeVisible()
    await expect(body().getByRole('link', { name: 'Settings → Closing' })).toHaveAttribute(
      'href',
      '/settings/periods/', // trailingSlash export
    )
  },
}
