import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ProductForm } from './product-form'
import { bulkActions } from './products-page'

afterEach(() => vi.unstubAllGlobals())

const renderForm = () => {
  const onSaved = vi.fn<() => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ProductForm
          defaults={{ currency: 'CHF', vat_registered: true, default_vat_rate: '8.1' }}
          onClose={vi.fn<() => void>()}
          onSaved={onSaved}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { onSaved }
}

test('previews the gross price while typing and saves with ⌘Enter', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    Response.json(
      { data: { id: 'prd_1', name: 'Web design', ...JSON.parse(String(init?.body)) } },
      { status: 201 },
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()

  await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Web design')
  await userEvent.type(screen.getByRole('textbox', { name: /Unit price/ }), '150')
  expect(screen.getByRole('status', { name: 'Price per unit' })).toHaveTextContent('CHF 162.15')
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

  await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 3000 })
  const body: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
  expect(body).toMatchObject({
    name: 'Web design',
    unit_price: '150.00',
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
