import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ProductPicker } from '@/components/products/product-picker'
import type { Product, ProductInput } from '@/lib/products'
import { sampleSettings } from '@/test/invoice-api'

import { sessionHandler } from './screen-fixtures'

const service: Product = {
  id: 'prd_service',
  type: 'service',
  name: 'Service 1',
  description: '',
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

const picked = fn()
const created = fn()

/** The catalogue holds `products`; a search keeps those whose name holds the term. */
const handlers = (products: Product[], scopes?: string[]) => [
  sessionHandler(scopes ? { role: 'member', scopes } : {}),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  http.get('/api/v1/products/search', ({ request }) => {
    const term = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase()
    return HttpResponse.json({
      data: products.filter((product) => product.name.toLowerCase().includes(term)),
    })
  }),
  http.post<never, ProductInput>('/api/v1/products', async ({ request }) => {
    const input = await request.json()
    created(input)
    return HttpResponse.json({ data: { ...service, ...input, id: 'prd_new' } }, { status: 201 })
  }),
]

const meta = {
  title: 'Invoices/Catalogue picker',
  parameters: { msw: { handlers: handlers([service]) } },
  render: () => <ProductPicker currency="CHF" vatMode="exclusive" onPick={picked} />,
  beforeEach: () => {
    picked.mockClear()
    created.mockClear()
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = within(document.body)
const openPicker = async (canvasElement: HTMLElement) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add from catalogue' }))
  return body.findByRole('listbox')
}

/** An empty catalogue: the add row is the list's only row. */
export const Empty: Story = {
  parameters: { msw: { handlers: handlers([]) } },
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement)
    await expect(await body.findByText('Your catalogue is empty.')).toBeVisible()
    await expect(body.getByRole('option', { name: 'Add to catalogue' })).toBeVisible()
  },
}

/** With items the add row stays last, reached with the arrows and Enter like an item. */
export const WithItems: Story = {
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement)
    await expect(await body.findByRole('option', { name: /Service 1/ })).toBeVisible()
    const options = body.getAllByRole('option')
    await expect(options.at(-1)).toHaveAccessibleName('Add to catalogue')
    await userEvent.keyboard('{ArrowDown}')
    await expect(body.getByRole('option', { name: 'Add to catalogue' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.keyboard('{Enter}')
    await expect(await body.findByRole('textbox', { name: 'Name' })).toHaveValue('')
  },
}

/** A search nothing matches: the row names what was typed and the new item starts with that name. */
export const SearchWithoutMatch: Story = {
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement)
    await userEvent.type(body.getByRole('combobox'), 'Design workshop')
    const add = await body.findByRole('option', { name: 'Add “Design workshop” to catalogue' })
    // The list catches up with the search a moment after the typing.
    await waitFor(() => expect(body.queryByRole('option', { name: /Service 1/ })).toBeNull())
    await userEvent.click(add)
    await expect(await body.findByRole('textbox', { name: 'Name' })).toHaveValue('Design workshop')
    await userEvent.type(body.getByRole('textbox', { name: /Unit price/ }), '900')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(picked).toHaveBeenCalledOnce())
    await expect(created).toHaveBeenCalledWith(expect.objectContaining({ name: 'Design workshop' }))
  },
}

/** A search that names an item exactly offers a new item without repeating the name. */
export const SearchWithExactMatch: Story = {
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement)
    await userEvent.type(body.getByRole('combobox'), 'service 1')
    await expect(await body.findByRole('option', { name: /Service 1/ })).toBeVisible()
    await expect(body.getByRole('option', { name: 'Add to catalogue' })).toBeVisible()
  },
}

/** Someone who may not change the catalogue picks from it, without the add row. */
export const NoPermission: Story = {
  parameters: { msw: { handlers: handlers([service], ['read:*', 'write:invoices']) } },
  play: async ({ canvasElement }) => {
    await openPicker(canvasElement)
    await expect(await body.findByRole('option', { name: /Service 1/ })).toBeVisible()
    await expect(body.queryByRole('option', { name: /to catalogue/ })).toBeNull()
  },
}
