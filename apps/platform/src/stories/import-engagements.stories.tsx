import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ImportDrawer } from '@/components/import/import-drawer'
import type { ImportBatch, ImportRecord } from '@/lib/imports'
import { sampleClient } from '@/test/invoice-fixtures'

import { emptyPage, sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Import engagements',
  parameters: { layout: 'fullscreen' },
  render: () => <ImportDrawer kind="engagements" onClose={() => {}} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const client = sampleClient()
const retainer = {
  title: 'Support retainer',
  quantity: '20',
  unit: 'hour',
  unit_price: '150.00',
  recurrence: 'monthly',
  start_date: '2026-12-01',
}

const record = (id: string, over: Partial<ImportRecord> = {}): ImportRecord => ({
  id,
  file_id: 'imf_1',
  kind: 'engagements',
  status: 'pending',
  data: { client_name: client.name, ...retainer },
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
  ...over,
})

const matched = record('imr_matched')
const unmatched = record('imr_unmatched', {
  data: { client_name: 'Alpenglow Studio', ...retainer, title: 'Website care' },
  issues: { client_id: 'No client matches this document: choose one.' },
})

const batch = (records: ImportRecord[]): ImportBatch => ({
  id: 'imp_eng',
  kind: 'engagements',
  status: 'review',
  created_at: '2026-11-08T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'offer-alpenglow.pdf',
      size: 81_000,
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

let current = batch([matched, unmatched])
let patched: Record<string, string | null> = {}

const body = () => within(document.body)

/** A document's client that matches no one waits unticked; choosing one in review clears the issue. */
export const PickClientWhenUnmatched: Story = {
  beforeEach: () => {
    current = batch([matched, unmatched])
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
                id: 'imp_eng',
                kind: 'engagements',
                status: 'review',
                created_at: '2026-11-08T09:30:00Z',
                pending: 2,
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
        http.patch<{ id: string; record: string }, { data: Record<string, string | null> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            patched = (await request.json()).data
            const fixed = record('imr_unmatched', {
              data: { ...unmatched.data, client_id: client.id, client_name: client.name },
            })
            current = batch([matched, fixed])
            return HttpResponse.json({ data: fixed })
          },
        ),
      ],
    },
  },
  play: async () => {
    await waitFor(() =>
      expect(body().getByRole('dialog', { name: 'Import engagements' })).toBeVisible(),
    )
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    await body().findByRole('table', { name: 'Records found' })
    // An engagements import says nothing about invoices.
    await expect(body().queryByText('Importing invoices?')).toBeNull()
    await expect(body().getByRole('checkbox', { name: 'Select Support retainer' })).toBeChecked()
    await expect(body().getByRole('checkbox', { name: 'Select Website care' })).not.toBeChecked()
    await expect(
      body().getByRole('button', { name: /Client: No client matches this document/ }),
    ).toBeVisible()

    await userEvent.click(body().getByRole('button', { name: 'Edit Website care' }))
    const picker = await body().findByRole('button', { name: 'Client' })
    await expect(picker).toHaveAttribute('aria-invalid', 'true')
    await expect(picker).toHaveTextContent('Choose a client (document: Alpenglow Studio)')
    await userEvent.click(picker)
    await userEvent.click(await body().findByRole('option', { name: new RegExp(client.name) }))
    await expect(picker).toHaveTextContent(client.name)
    await userEvent.click(body().getByRole('button', { name: 'Save' }))

    await body().findByRole('table', { name: 'Records found' })
    await expect(patched).toMatchObject({ client_id: client.id, title: 'Website care' })
    await expect(body().queryByRole('button', { name: /No client matches/ })).toBeNull()
    await expect(body().getByRole('checkbox', { name: 'Select Website care' })).toBeChecked()
    await expect(body().getByRole('button', { name: 'Import 2' })).toBeEnabled()
  },
}

const unmappable = record('imr_unmappable', {
  data: {
    client_name: 'Alpenglow Studio',
    client_city: 'Chur',
    ...retainer,
    title: 'Website care',
    billing: 'whenever convenient',
  },
  issues: { client_id: 'No client matches this document: choose one.' },
})

/**
 * Edit opens the real New engagement form, prefilled from the document: its sections, choice cards and unit list,
 * the document's client card on top of the client field, and an error where a value fits none of the choices.
 */
export const EditInTheRealForm: Story = {
  beforeEach: () => {
    current = batch([unmappable])
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
                id: 'imp_eng',
                kind: 'engagements',
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
        http.patch<{ id: string; record: string }, { data: Record<string, string | null> }>(
          '/api/v1/imports/:id/records/:record',
          async ({ request }) => {
            patched = (await request.json()).data
            // The server drops cleared (null) fields.
            const kept = Object.entries(patched).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            )
            const fixed = record('imr_unmappable', {
              data: { ...unmappable.data, ...Object.fromEntries(kept), client_name: client.name },
            })
            current = batch([fixed])
            return HttpResponse.json({ data: fixed })
          },
        ),
      ],
    },
  },
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Continue import' }))
    await userEvent.click(await body().findByRole('button', { name: 'Edit Website care' }))
    const form = await body().findByRole('dialog', { name: 'Edit record: Website care' })
    const inForm = within(form)
    await expect(inForm.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(
      expect.arrayContaining(['Client & service', 'Scope', 'Schedule', 'Invoicing']),
    )
    await expect(inForm.getByRole('radio', { name: 'Recurring' })).toBeChecked()
    await expect(inForm.getByRole('textbox', { name: 'Title' })).toHaveValue('Website care')
    await expect(inForm.getByRole('region', { name: 'Found on the document' })).toBeVisible()
    await expect(
      inForm.getByRole('button', { name: /Create client "Alpenglow Studio"/ }),
    ).toBeVisible()
    // Billing "whenever convenient" is none of the cards: they say so and keep the default.
    const billing = inForm.getByRole('radiogroup', { name: 'Billing' })
    await expect(billing).toHaveAttribute('aria-invalid', 'true')
    await expect(
      inForm.getByText(/The document says “whenever convenient”, which is none of these choices/),
    ).toBeVisible()
    // Nothing an import cannot hold: no invoice drafts, no contract document.
    await expect(inForm.queryByText('Create invoice drafts automatically')).toBeNull()

    await userEvent.click(inForm.getByRole('button', { name: /Pick an existing client/ }))
    await userEvent.click(await body().findByRole('option', { name: new RegExp(client.name) }))
    await userEvent.click(inForm.getByRole('radio', { name: /Arrears/ }))
    await userEvent.click(inForm.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(body().queryByRole('dialog', { name: 'Edit record: Website care' })).toBeNull(),
    )
    await expect(patched).toMatchObject({
      client_id: client.id,
      billing: 'arrears',
      recurrence: 'monthly',
      interval: 1,
      unit: 'hour',
      start_date: '2026-12-01',
    })
  },
}
