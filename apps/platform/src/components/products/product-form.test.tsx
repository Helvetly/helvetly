import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Product } from '@/lib/products'

import { ProductForm } from './product-form'
import { bulkActions } from './products-page'

afterEach(() => vi.unstubAllGlobals())

const renderForm = (product?: Product) => {
  const onSaved = vi.fn<() => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ProductForm
          product={product}
          defaults={{ currency: 'CHF', vat_registered: true, default_vat_rate: '8.1' }}
          onClose={vi.fn<() => void>()}
          onSaved={onSaved}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { onSaved }
}

test('a new item is priced gross: previews the net part while typing and saves with ⌘Enter', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    Response.json(
      { data: { id: 'prd_1', name: 'Web design', ...JSON.parse(String(init?.body)) } },
      { status: 201 },
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()

  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Web design')
  expect(screen.getByRole('radio', { name: 'Gross' })).toBeChecked()
  await userEvent.type(screen.getByRole('textbox', { name: /Unit price/ }), '150')
  const preview = screen.getByRole('status', { name: 'Price per unit' })
  expect(preview).toHaveTextContent('CHF 138.76')
  expect(preview).toHaveTextContent('CHF 11.24')
  expect(preview).toHaveTextContent('CHF 150.00')
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

  await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 3000 })
  const body: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
  expect(body).toMatchObject({
    name: 'Web design',
    unit_price: '150.00',
    price_basis: 'gross',
    vat_category: 'S',
    vat_rate: '8.1',
    currency: 'CHF',
  })
})

test('a taken SKU from the server lands on its field and gets focus', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { sku: 'Another active item already uses this SKU.' } },
          },
        },
        { status: 422 },
      ),
    ),
  )
  const { onSaved } = renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Hosting')
  await userEvent.type(screen.getByRole('textbox', { name: /Unit price/ }), '20')
  await userEvent.type(screen.getByRole('textbox', { name: /SKU/ }), 'HOST')
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }))

  expect(
    await screen.findByText('Another active item already uses this SKU.', {}, { timeout: 3000 }),
  ).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('textbox', { name: /SKU/ })).toHaveFocus(), {
    timeout: 3000,
  })
  expect(onSaved).not.toHaveBeenCalled()
})

test('checks required fields before sending anything', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  vi.stubGlobal('fetch', fetch)
  renderForm()
  await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
  expect(screen.getByText('Enter a name.')).toBeInTheDocument()
  expect(screen.getByText('Enter a price.')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

test('repeated save shortcuts while creating an item send one request', async () => {
  const { promise: response, resolve: complete } = Promise.withResolvers<Response>()
  const fetch = vi.fn<typeof globalThis.fetch>(() => response)
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Hosting')
  await userEvent.type(screen.getByRole('textbox', { name: /Unit price/ }), '20')
  await userEvent.keyboard('{Meta>}{Enter}{Enter}{/Meta}')
  expect(fetch).toHaveBeenCalledOnce()
  complete(Response.json({ data: { id: 'prd_1', name: 'Hosting' } }, { status: 201 }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
})

test('save shortcuts cannot resubmit a successful product while its route is closing', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ data: { id: 'prd_1', name: 'Hosting' } }, { status: 201 }),
  )
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Hosting')
  await userEvent.type(screen.getByRole('textbox', { name: /Unit price/ }), '20')
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

test('members get export only in the bulk bar', () => {
  const run = {
    archive: vi.fn<() => void>(),
    unarchive: vi.fn<() => void>(),
    exportCsv: vi.fn<() => void>(),
    remove: vi.fn<() => void>(),
  }
  expect(bulkActions(false, false, run).map((action) => action.label)).toEqual(['Export CSV'])
  expect(bulkActions(true, true, run).map((action) => action.label)).toEqual([
    'Restore',
    'Export CSV',
    'Delete',
  ])
})

const netItem: Product = {
  id: 'prd_1',
  type: 'service',
  name: 'Consulting',
  description: 'Strategy sessions.',
  sku: null,
  gtin: null,
  unit: 'hour',
  price_basis: 'net',
  unit_price: '150.00',
  unit_price_net: '150.00',
  unit_price_gross: '162.15',
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  is_archived: false,
  archived_at: null,
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
}

test('an item saved net keeps net when edited', () => {
  renderForm(netItem)
  expect(screen.getByRole('radio', { name: 'Net' })).toBeChecked()
  expect(screen.getByRole('status', { name: 'Price per unit' })).toHaveTextContent('CHF 162.15')
})

test('the currency sits in the price field and the VAT rate beside the VAT category', async () => {
  renderForm()
  const price = screen.getByRole('textbox', { name: /Unit price/ })
  const row = price.parentElement?.parentElement
  expect(row).toContainElement(screen.getByRole('button', { name: 'Currency CHF' }))
  expect(row).toContainElement(screen.getByRole('radio', { name: 'Gross' }))
  const rate = screen.getByRole('textbox', { name: 'VAT rate' })
  expect(rate.closest('[data-slot=form-field]')).toContainElement(
    document.getElementById('product-vat_category'),
  )
  // Outside VAT there is no rate to enter.
  await userEvent.click(document.getElementById('product-vat_category') ?? document.body)
  await userEvent.click(await screen.findByRole('option', { name: /Not subject/ }))
  expect(screen.queryByRole('textbox', { name: 'VAT rate' })).not.toBeInTheDocument()
})

test('Write with AI and the count sit inside the description field', async () => {
  renderForm()
  const description = screen.getByRole('textbox', { name: /Description/ })
  const box = description.closest('[data-slot=textarea-box]')
  expect(box).toContainElement(screen.getByRole('button', { name: 'Write with AI' }))
  expect(box).toHaveTextContent('0 / 1000')
  await userEvent.type(description, 'Two revisions')
  expect(box).toHaveTextContent('13 / 1000')
})

test('the AI draft is written from the unsaved values of the form', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ data: { text: 'Hourly web design.' } }),
  )
  vi.stubGlobal('fetch', fetch)
  renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Web design')
  await userEvent.type(screen.getByRole('textbox', { name: /Unit price/ }), '120')
  await userEvent.click(screen.getByRole('button', { name: 'Write with AI' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Write a draft' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  const [url, init] = fetch.mock.calls[0] ?? []
  expect(url).toBe('/api/v1/ai/write')
  expect(JSON.parse(String(init?.body))).toMatchObject({
    field: 'product_description',
    action: 'draft',
    text: '',
    max_length: 1000,
    context: {
      name: 'Web design',
      kind: 'service',
      price: 'CHF 120 gross',
      vat: 'Standard',
      vat_rate: '8.1 %',
    },
  })
  await userEvent.click(await screen.findByRole('button', { name: 'Use this' }))
  expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue('Hourly web design.')
})
