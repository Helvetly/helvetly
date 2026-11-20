import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ImportDrawer } from '@/components/import/import-drawer'
import type { ImportBatch, ImportRecord } from '@/lib/imports'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import products',
  parameters: { layout: 'fullscreen' },
  render: () => <ImportDrawer kind="products" onClose={() => {}} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A price-list row whose type word is neither a product nor a service. */
const read: ImportRecord = {
  id: 'imr_item',
  file_id: 'imf_1',
  kind: 'products',
  status: 'pending',
  data: { type: 'gizmo', name: 'USB-C cable', unit: 'pcs', unit_price: '19.90', currency: 'CHF' },
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
}

const batch = (records: ImportRecord[]): ImportBatch => ({
  id: 'imp_products',
  kind: 'products',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'price-list.xlsx',
      size: 12_000,
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

const body = () => within(document.body)

let current = batch([read])
let patched: Record<string, unknown> = {}

/** Edit opens the real catalogue form, prefilled; a type it cannot map is an error until one is chosen. */
export const EditInTheRealForm: Story = {
  beforeEach: () => {
    current = batch([read])
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
                id: 'imp_products',
                kind: 'products',
                status: 'review',
                created_at: '2026-11-08T09:30:00Z',
                pending: 1,
              },
            ],
          }),
        ),
        http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: current })),
        http.patch<{ id: string; record: string }, { data: Record<string, unknown> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            patched = (await request.json()).data
            const fixed: ImportRecord = { ...read, data: { ...read.data, type: 'product' } }
            current = batch([fixed])
            return HttpResponse.json({ data: fixed })
          },
        ),
      ],
    },
  },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    await userEvent.click(await body().findByRole('button', { name: 'Edit USB-C cable' }))
    const form = await body().findByRole('dialog', { name: 'Edit record: USB-C cable' })
    const inForm = within(form)
    await expect(inForm.getByRole('textbox', { name: /Name/ })).toHaveValue('USB-C cable')
    await expect(inForm.getByRole('heading', { name: 'Price' })).toBeVisible()
    await expect(
      inForm.getByText(/The document says “gizmo”, which is none of these choices/),
    ).toBeVisible()

    await userEvent.click(inForm.getByRole('radio', { name: 'Product' }))
    await userEvent.click(inForm.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(body().queryByRole('dialog', { name: 'Edit record: USB-C cable' })).toBeNull(),
    )
    await expect(patched).toMatchObject({ type: 'product', unit: 'piece', unit_price: '19.90' })
  },
}
