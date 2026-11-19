import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Product } from '@/lib/products'

import { ProductPicker } from './product-picker'

afterEach(() => vi.unstubAllGlobals())

const hosting: Product = {
  id: 'prd_1',
  type: 'service',
  name: 'Hosting',
  description: 'Monthly, managed',
  sku: 'HOST',
  gtin: null,
  unit: 'month',
  price_basis: 'gross',
  unit_price: '21.62',
  unit_price_net: '20.00',
  unit_price_gross: '21.62',
  currency: 'EUR',
  vat_category: 'S',
  vat_rate: '8.1',
  is_archived: false,
  archived_at: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}

test('searches the catalogue and hands back the line for the invoice’s VAT mode', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [hosting] }))
  vi.stubGlobal('fetch', fetch)
  const onPick = vi.fn<(line: unknown, product: Product) => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductPicker currency="CHF" vatMode="inclusive" onPick={onPick} />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add from catalogue' }))
  await userEvent.type(screen.getByPlaceholderText('Search name, SKU or GTIN…'), 'host')
  await waitFor(() => expect(String(fetch.mock.calls.at(-1)?.[0])).toContain('q=host'))
  expect(String(fetch.mock.calls.at(-1)?.[0])).toContain('currency=CHF')

  // Another currency is said, never converted.
  const option = await screen.findByRole('option', { name: /Hosting/ })
  expect(option).toHaveTextContent('in EUR')
  expect(option).toHaveTextContent('EUR 21.62')
  await userEvent.click(option)

  expect(onPick).toHaveBeenCalledWith(
    {
      description: 'Hosting – Monthly, managed',
      quantity: '1',
      unit: 'month',
      unit_price: '21.62',
      vat_category: 'S',
      vat_rate: '8.1',
    },
    hosting,
  )
})
