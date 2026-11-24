import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { ImportDrawer } from '@/components/import/import-drawer'
import type { ExpenseCategory } from '@/lib/expenses'
import type { ImportBatch, ImportRecord } from '@/lib/imports'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import expenses',
  parameters: { layout: 'fullscreen' },
  render: () => <ImportDrawer kind="expenses" onClose={() => {}} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const record = (id: string, over: Partial<ImportRecord> = {}): ImportRecord => ({
  id,
  file_id: 'imf_1',
  kind: 'expenses',
  status: 'pending',
  data: {
    supplier_name: 'Migros',
    document_date: '2026-11-02',
    amount: '108.10',
    currency: 'CHF',
    vat_rate: '8.1',
  },
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
  ...over,
})

const clean = record('imr_clean')
const wrongRate = record('imr_rate', {
  data: {
    supplier_name: 'Hotel Adler',
    document_date: '2026-10-14',
    amount: '205.00',
    currency: 'CHF',
    vat_rate: '7.7',
  },
  issues: { vat_rate: 'Swiss VAT is 8.1, 2.6 or 3.8 % (7.7, 2.5 or 3.7 % before 2024), or 0.' },
})
const repeated = record('imr_dup', {
  data: {
    supplier_name: 'SBB',
    document_date: '2026-10-30',
    amount: '58.00',
    currency: 'CHF',
    vat_rate: '8.1',
  },
  duplicate: { id: 'exp_9', label: 'Expense 9 · SBB', reason: 'same date and total' },
})

const batch = (records: ImportRecord[]): ImportBatch => ({
  id: 'imp_receipts',
  kind: 'expenses',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'receipts.zip › migros.jpg',
      size: 310_000,
      content_type: 'image/jpeg',
      status: 'done',
      error: null,
      chunks_done: 1,
      chunks_total: 1,
      reused: false,
      document_type: null,
    },
  ],
  records,
})

let current = batch([clean, wrongRate, repeated])
const body = () => within(document.body)

const startingCategories: ExpenseCategory[] = [
  {
    id: 'exc_1',
    name: 'Travel',
    account_code: '6640',
    preset: 'travel',
    vat_treatment: 'standard',
    is_archived: false,
    expenses_count: 3,
  },
  {
    id: 'exc_2',
    name: 'Telecom',
    account_code: '6510',
    preset: null,
    vat_treatment: null,
    is_archived: false,
    expenses_count: 1,
  },
]
let categories = startingCategories
/** Every request the drawer and its record editor make besides the import's own. */
const drawerHandlers = [
  sessionHandler(),
  http.get('/api/v1/billing', () =>
    HttpResponse.json({
      data: billingFixture({ plan: 'business', status: 'active', interval: 'month' }),
    }),
  ),
  http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: categories })),
  http.post<never, { name: string; account_code: string }>(
    '/api/v1/expense-categories',
    async ({ request }) => {
      const input = await request.json()
      const created = {
        id: `exc_${categories.length + 1}`,
        ...input,
        preset: null,
        vat_treatment: null,
        is_archived: false,
        expenses_count: 0,
      }
      categories = [...categories, created]
      return HttpResponse.json({ data: created }, { status: 201 })
    },
  ),
]

/**
 * Receipts read into draft expenses: the wrong Swiss rate and the receipt already booked wait for a look;
 * fixing the rate ticks the row, and the import creates the drafts that then wait in "To review".
 */
export const ReviewReceipts: Story = {
  beforeEach: () => {
    current = batch([clean, wrongRate, repeated])
  },
  parameters: {
    msw: {
      handlers: [
        ...drawerHandlers,
        http.get('/api/v1/imports', () =>
          HttpResponse.json({
            data: [
              {
                id: current.id,
                kind: 'expenses',
                status: 'review',
                created_at: current.created_at,
                pending: 3,
              },
            ],
          }),
        ),
        http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: current })),
        http.patch<{ id: string; record: string }, { data: Record<string, string | null> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            const { data } = await request.json()
            const fixed = record('imr_rate', {
              data: { ...wrongRate.data, vat_rate: data.vat_rate ?? '' },
            })
            current = batch(current.records.map((r) => (r.id === fixed.id ? fixed : r)))
            return HttpResponse.json({ data: fixed })
          },
        ),
        http.post<never, { record_ids: string[] }>(
          '/api/v1/imports/:id/commit',
          async ({ request }) => {
            const { record_ids } = await request.json()
            current = batch(
              current.records.map((r) =>
                record_ids.includes(r.id)
                  ? { ...r, status: 'created', entity_id: `exp_${r.id}` }
                  : r,
              ),
            )
            return HttpResponse.json({
              data: {
                results: record_ids.map((id) => ({
                  id,
                  status: 'created',
                  entity_id: `exp_${id}`,
                  error: null,
                  conflict: null,
                })),
                batch: current,
              },
            })
          },
        ),
      ],
    },
  },
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Import expenses' })
    await waitFor(() => expect(dialog).toBeVisible())
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    const table = await body().findByRole('table', { name: 'Records found' })
    await Promise.all(
      ['Supplier', 'Date', 'Amount', 'Currency', 'VAT rate'].map((header) =>
        expect(within(table).getByRole('columnheader', { name: header })).toBeVisible(),
      ),
    )

    await expect(
      body().getByRole('button', { name: /Swiss VAT is 8.1, 2.6 or 3.8 %/ }),
    ).toBeVisible()
    await expect(body().getByText('Already in Helvetly: Expense 9 · SBB')).toBeVisible()
    await expect(body().getByRole('button', { name: 'Import 1' })).toBeEnabled()

    await userEvent.click(body().getByRole('button', { name: 'Edit Hotel Adler' }))
    const rate = await body().findByRole('textbox', { name: 'VAT rate' })
    await expect(rate).toHaveAttribute('aria-invalid', 'true')
    await userEvent.clear(rate)
    await userEvent.type(rate, '3.8')
    await userEvent.click(body().getByRole('button', { name: 'Save' }))
    await body().findByRole('table', { name: 'Records found' })
    await expect(body().queryByRole('button', { name: /Swiss VAT is 8.1/ })).toBeNull()
    await expect(body().getByRole('checkbox', { name: 'Select Hotel Adler' })).toBeChecked()

    await userEvent.click(body().getByRole('button', { name: 'Import 2' }))
    await expect(await body().findByText('2 created')).toBeVisible()
    await expect(body().getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/expenses\/?\?id=exp_imr_clean$/),
    )
    await expect(body().getByRole('checkbox', { name: 'Select SBB' })).not.toBeChecked()
  },
}

const suggestedCategory = record('imr_cat', {
  data: { ...clean.data, supplier_name: 'Apple Store', category: 'Software' },
  issues: { category: '“Software” is a new category: create it or choose one of the list.' },
})

/** The model suggested a category the workspace lacks: the editor offers to create it, and the name stays. */
export const SuggestedNewCategory: Story = {
  beforeEach: () => {
    categories = startingCategories
  },
  parameters: {
    msw: {
      handlers: [
        ...drawerHandlers,
        http.get('/api/v1/imports', () =>
          HttpResponse.json({
            data: [
              {
                id: 'imp_receipts',
                kind: 'expenses',
                status: 'review',
                created_at: '2026-11-08T09:30:00Z',
                pending: 1,
              },
            ],
          }),
        ),
        http.get('/api/v1/imports/:id', () =>
          HttpResponse.json({ data: batch([suggestedCategory]) }),
        ),
      ],
    },
  },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    await userEvent.click(await body().findByRole('button', { name: 'Edit Apple Store' }))
    await expect(await body().findByText('Suggested new category: Software')).toBeVisible()
    // Only owners and admins create categories, so the button waits for the session, which may land after the list.
    await userEvent.click(await body().findByRole('button', { name: 'Create' }))
    const name = await body().findByRole('textbox', { name: 'Category name' })
    await expect(name).toHaveValue('Software')
    const popover = name.closest('[data-slot="popover-content"]')
    if (!(popover instanceof HTMLElement)) throw new Error('The category name is not in a popover')
    await userEvent.click(within(popover).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(body().queryByRole('textbox', { name: 'Category name' })).toBeNull())
    await waitFor(() => expect(body().queryByText('Suggested new category: Software')).toBeNull())
    await expect(categories.map((category) => category.name)).toContain('Software')
  },
}
