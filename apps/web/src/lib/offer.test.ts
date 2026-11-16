import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { confirms, OFFER_URL, projectPlans, sameJSON, useOffer } from './offer'
import golden from './public-offer.golden.json'

const published = {
  offer_id: 'helvetly-v2',
  schema_version: 1,
  checksum: 'x',
  published_at: '2026-11-15T00:00:00Z',
}
const body = (values: object = golden) => JSON.stringify({ data: { ...published, ...values } })

function answer(...responses: (() => Promise<Response>)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>()
  for (const r of responses) fetch.mockImplementationOnce(r)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('projectPlans', () => {
  // public-offer.golden.json is what the API publishes (TestPublicOfferGolden in apps/api/internal/billing).
  it('is what the API publishes', () => {
    expect(projectPlans()).toEqual(golden)
    expect(sameJSON(projectPlans(), golden)).toBe(true)
  })
})

describe('confirms', () => {
  // A build in another language words plans and benefits in its own catalog.
  it('ignores the wording of plans and benefits, not their values', () => {
    const reworded = {
      ...golden,
      plans: golden.plans.map((p) => ({ ...p, name: `${p.name}!` })),
      comparison: golden.comparison.map((c) => ({ ...c, label: `${c.label}!`, note: 'x' })),
    }
    expect(confirms(JSON.parse(body(reworded)))).toBe(true)
    expect(confirms(JSON.parse(body({ ...golden, usage_details: [] })))).toBe(false)
  })
})

describe('sameJSON', () => {
  it.each([
    [{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }, true],
    [{ a: 1, n: undefined }, { a: 1 }, true],
    [{ a: 1 }, { a: 2 }, false],
    [{ a: [1, 2] }, { a: [2, 1] }, false],
    [{ a: [] }, { a: {} }, false],
    [{ a: null }, { a: 0 }, false],
  ])('%j and %j: %s', (a, b, same) => expect(sameJSON(a, b)).toBe(same))
})

describe('useOffer', () => {
  it('is current when the API publishes what the site was built with', async () => {
    const fetch = answer(async () => new Response(body()))
    const { result } = renderHook(useOffer)
    expect(result.current.status).toBe('pending')
    await waitFor(() => expect(result.current.status).toBe('current'))
    expect(result.current.checking).toBe(false)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(OFFER_URL)
  })

  const pro = golden.plans[1]!
  const other = {
    ...golden,
    plans: [
      golden.plans[0],
      { ...pro, prices: { ...pro.prices, CHF: { month: 5900, year: 56700 } } },
      golden.plans[2],
    ],
  }
  it.each([
    ['another price', async () => new Response(body(other))],
    [
      'another seat cap',
      async () =>
        new Response(
          body({ ...golden, max_self_service_seats: { basic: 25, pro: 25, business: null } }),
        ),
    ],
    [
      'another comparison',
      async () => new Response(body({ ...golden, comparison: golden.comparison.slice(1) })),
    ],
    [
      'no published offer',
      async () => new Response('{"error":"pricing_unavailable"}', { status: 503 }),
    ],
    ['bad JSON', async () => new Response('<html>')],
    ['a body without data', async () => new Response('{}')],
    ['no network', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('is unavailable on %s', async (_, response) => {
    answer(response)
    const { result } = renderHook(useOffer)
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })

  it('asks again on retry, keeping the status while it checks', async () => {
    const later = Promise.withResolvers<Response>()
    const fetch = answer(
      async () => Promise.reject(new TypeError('Failed to fetch')),
      () => later.promise,
    )
    const { result } = renderHook(useOffer)
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    act(() => result.current.retry())
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(result.current).toMatchObject({ status: 'unavailable', checking: true })
    act(() => later.resolve(new Response(body())))
    await waitFor(() =>
      expect(result.current).toMatchObject({ status: 'current', checking: false }),
    )
  })
})
