import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ProductsPage } from '@/components/products/products-page'
import type { Product } from '@/lib/products'

import { products } from './api'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'
import { dropOpensImport, emptyList, emptyOffersImport, noDropTarget, readOnly } from './page-drop'

const meta = {
  title: 'Pages/Products and services',
  beforeEach: closeHeidi,
  parameters: pageParameters('/products'),
  render: () => (
    <Frame>
      <ProductsPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Workshop day') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

const saved = fn()
const first = products.find((entry) => entry.id === 'prd_1')
if (!first) throw new Error('The sample products lack prd_1.')
/** prd_1 as the API keeps it: a PATCH changes what the next GET returns; each story starts afresh. */
let current: Product = first
const editableProduct = [
  http.get('/api/v1/products/prd_1', () => HttpResponse.json({ data: current })),
  http.patch<never, Partial<Product>>('/api/v1/products/prd_1', async ({ request }) => {
    const input = await request.json()
    saved(input)
    current = { ...current, ...input, sku: input.sku === '' ? null : (input.sku ?? current.sku) }
    return HttpResponse.json({ data: current })
  }),
]

/** A SKU, once added, changes in place like the client's internal ID; the editor clears the card's separators. */
export const EditSku: Story = {
  parameters: pageParameters('/products', { id: 'prd_1' }, editableProduct),
  beforeEach: () => {
    current = first
    saved.mockClear()
  },
  play: async () => {
    const body = within(document.body)
    const heading = await body.findByRole('heading', { name: 'Identifiers' }, { timeout: 8000 })
    const card = within(heading.closest('section') ?? document.body)
    await userEvent.click(await card.findByRole('button', { name: /Edit SKU/ }))
    const sku = card.getByRole('textbox', { name: 'SKU' })
    await waitFor(() => expect(sku).toHaveFocus())
    await expect(sku).toHaveValue('DES-H')

    // The open input sits inside its row, clear of the separator above (focus ring included).
    const row = sku.closest('.group\\/row')
    if (!row) throw new Error('The SKU input is not inside its row.')
    const gap = sku.getBoundingClientRect().top - row.getBoundingClientRect().top
    expect(gap).toBeGreaterThanOrEqual(4)

    await userEvent.clear(sku)
    await userEvent.type(sku, 'DES-HOUR{Enter}')
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith({ sku: 'DES-HOUR' }))
    await expect(await card.findByText('DES-HOUR')).toBeVisible()
    // Still editable after the change.
    await expect(card.getByRole('button', { name: /Edit SKU/ })).toBeVisible()
  },
}
export const EditSkuDark = dark(EditSku)

/** A new workspace: next to its first action the empty list offers Import, and a drop anywhere works too. */
export const Empty: Story = {
  parameters: emptyList('/products', '/api/v1/products'),
  play: emptyOffersImport('No products or services yet'),
}
export const EmptyDark = dark(Empty)
export const EmptyPhone = phone(Empty)

/** Files dropped anywhere on the page open its import with them chosen. */
export const DropStartsImport: Story = {
  parameters: emptyList('/products', '/api/v1/products'),
  play: dropOpensImport(
    'No products or services yet',
    'Drop to read these files into products and services',
    'products',
    new File(['name,price\nDesign hour,150'], 'price-list.csv', { type: 'text/csv' }),
  ),
}

/** Whoever may only read has no drop target and no hint. */
export const ReadOnlyNoDrop: Story = {
  parameters: readOnly('/products'),
  play: noDropTarget('Workshop day', 'products'),
}
