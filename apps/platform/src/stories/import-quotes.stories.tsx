import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ImportDrawer } from '@/components/import/import-drawer'
import type { ImportBatch, ImportRecord } from '@/lib/imports'
import { editorApi } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { emptyPage, sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import quotes',
  parameters: { layout: 'fullscreen' },
  render: () => <ImportDrawer kind="quotes" onClose={() => {}} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const client = sampleClient()

/** A quote read from a PDF whose status word is none of Helvetly's. */
const read: ImportRecord = {
  id: 'imr_quote',
  file_id: 'imf_1',
  kind: 'quotes',
  status: 'pending',
  data: {
    client_id: client.id,
    client_name: client.name,
    number: 'OF-2026-031',
    issue_date: '2026-10-01',
    valid_until: '2026-10-31',
    currency: 'CHF',
    total: '1081.00',
    status: 'pending approval',
    lines: [{ description: 'Workshop', quantity: '8', unit_price: '125.00', vat_rate: '8.1' }],
  },
  issues: { status: 'Choose draft, sent, accepted or declined.' },
  duplicate: null,
  entity_id: null,
  error: null,
}

const batch = (records: ImportRecord[]): ImportBatch => ({
  id: 'imp_quotes',
  kind: 'quotes',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'OF-2026-031.pdf',
      size: 84_000,
      content_type: 'application/pdf',
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

/**
 * A quote is edited like an imported invoice (client, lines, totals beside the original), with its status and
 * validity instead of payments; a status the document words differently is an error until one is chosen.
 */
export const FixStatus: Story = {
  beforeEach: () => {
    current = batch([read])
    patched = {}
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        ...editorApi([]),
        http.get('/api/v1/imports', () =>
          HttpResponse.json({
            data: [
              {
                id: 'imp_quotes',
                kind: 'quotes',
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
            data: [client],
            meta: { ...emptyPage.meta, total: 1, total_pages: 1 },
          }),
        ),
        http.patch<{ id: string; record: string }, { data: Record<string, unknown> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            patched = (await request.json()).data
            const fixed: ImportRecord = {
              ...read,
              data: { ...read.data, status: 'sent' },
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
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    await body().findByRole('table', { name: 'Records found' })
    await expect(body().getByRole('checkbox', { name: 'Select OF-2026-031' })).not.toBeChecked()

    await userEvent.click(body().getByRole('button', { name: 'Edit OF-2026-031' }))
    const editor = await body().findByRole('dialog', { name: /Edit record/ })
    const inEditor = within(editor)
    await expect(inEditor.getByRole('heading', { name: 'Quote' })).toBeVisible()
    await expect(inEditor.queryByText('Already paid')).toBeNull()
    const status = inEditor.getByRole('button', { name: 'Status' })
    await expect(status).toHaveAttribute('aria-invalid', 'true')

    await userEvent.click(status)
    await userEvent.click(await body().findByRole('option', { name: 'Sent' }))
    await userEvent.click(inEditor.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(body().queryByRole('dialog', { name: /Edit record/ })).toBeNull())
    await expect(patched).toEqual({ status: 'sent' })
    await expect(body().getByRole('checkbox', { name: 'Select OF-2026-031' })).toBeChecked()
  },
}
