import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Product } from '@/lib/products'
import type * as Queries from '@/lib/queries'

const session = vi.hoisted(() => ({ role: 'owner' }))
vi.mock('@/lib/queries', async (actual) => ({
  ...(await actual<typeof Queries>()),
  useSession: () => ({ data: session }),
}))

const saved: Product = {
  id: 'prd_new',
  type: 'service',
  name: 'Consulting',
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

vi.mock('./product-form', () => ({
  ProductForm: ({ onSaved }: { onSaved: (product: Product, created: boolean) => void }) => (
    <button type="button" onClick={() => onSaved(saved, true)}>
      Save new item
    </button>
  ),
}))

import { ProductPicker } from './product-picker'

afterEach(() => {
  vi.unstubAllGlobals()
  session.role = 'owner'
})

function renderPicker(onPick = vi.fn<(line: unknown, product: Product) => void>()) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).includes('/invoice-settings')
        ? Response.json({
            data: { currency: 'CHF', vat_registered: true, default_vat_rate: '8.1' },
          })
        : Response.json({ data: [] }),
    ),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductPicker currency="CHF" vatMode="exclusive" onPick={onPick} />
    </QueryClientProvider>,
  )
  return onPick
}

test('an empty catalogue offers a new item, which is saved and lands on the invoice', async () => {
  const onPick = renderPicker()
  await userEvent.click(screen.getByRole('button', { name: 'Add from catalogue' }))
  expect(await screen.findByText('Your catalogue is empty.')).toBeVisible()
  await userEvent.click(await screen.findByRole('button', { name: 'Add to catalogue' }))

  await userEvent.click(await screen.findByRole('button', { name: 'Save new item' }))
  expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ description: 'Consulting', unit_price: '150.00' }),
    saved,
  )
  expect(screen.queryByRole('button', { name: 'Save new item' })).toBeNull()
})

test('a member who may not manage the catalogue is not offered a new item', async () => {
  session.role = 'member'
  renderPicker()
  await userEvent.click(screen.getByRole('button', { name: 'Add from catalogue' }))
  expect(await screen.findByText('Your catalogue is empty.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Add to catalogue' })).toBeNull()
})
