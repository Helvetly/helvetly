import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import golden from '@/lib/public-offer.golden.json'

import { OfferPrice, OfferProvider } from './offer-provider'

const offer = {
  offer_id: 'o',
  schema_version: 1,
  checksum: 'x',
  published_at: '2026-11-15T00:00:00Z',
}

function priceWith(response: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(response))
  render(
    <OfferProvider>
      <OfferPrice>CHF 49</OfferPrice>
    </OfferProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

it('shows the build price while the API confirms it', async () => {
  priceWith(async () => new Response(JSON.stringify({ data: { ...offer, ...golden } })))
  expect(screen.getByText('CHF 49')).toBeInTheDocument()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  expect(screen.getByText('CHF 49')).toBeInTheDocument()
})

it('says the price is unavailable when the API cannot confirm it', async () => {
  priceWith(async () => Promise.reject(new TypeError('Failed to fetch')))
  expect(await screen.findByText('Price unavailable')).toBeInTheDocument()
  expect(screen.queryByText('CHF 49')).not.toBeInTheDocument()
})
