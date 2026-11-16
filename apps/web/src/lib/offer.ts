import { defaultLocale } from '@helvetly/i18n'
// The offer on sale as the API publishes it (GET /api/v1/public/offers/current, publicOffer in
// apps/api/internal/billing/offers_http.go). Pages render plans.ts at build time; once they run, they ask the API and
// show prices only while it confirms the same values, so a visitor never sees a price the API would not charge.
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  type LimitKey,
  MAX_SELF_SERVICE_SEATS,
  type PerPlan,
  type PlanId,
  plansIn,
  priceOf,
  USAGE_DETAILS,
} from '@/lib/plans'
import { PLATFORM_URL } from '@/lib/site'

export const OFFER_URL = `${PLATFORM_URL}/api/v1/public/offers/current`

/** Per person, in minor units, tax included. */
type PublicPrice = { month: number; year: number }

export type PublicOffer = {
  offer_id: string
  schema_version: number
  checksum: string
  published_at: string
  price_per: 'person'
  tax_inclusive: true
  currencies: string[]
  plans: { id: PlanId; name: string; prices: Record<string, PublicPrice> }[]
  comparison: {
    key: string
    label: string
    note?: string
    limit_keys: LimitKey[]
    plans: PerPlan<boolean>
  }[]
  usage_details: LimitKey[]
  /** The people a workspace can have without asking us; null when unlimited. */
  max_self_service_seats: PerPlan<number | null>
  /** value: for one person; null when unlimited. */
  limits: Partial<
    Record<
      LimitKey,
      {
        unit: string
        period: string | null
        per_person: boolean
        plans: PerPlan<{ included: boolean; value: number | null }>
      }
    >
  >
}

/** The parts that name a published offer rather than what it sells. */
const IDENTITY = ['offer_id', 'schema_version', 'checksum', 'published_at'] as const
export type PublicOfferValues = Omit<PublicOffer, (typeof IDENTITY)[number]>

const CURRENCIES = ['CHF', 'EUR', 'USD']

const perPlan = <T>(of: (plan: PlanId) => T): PerPlan<T> => ({
  basic: of('basic'),
  pro: of('pro'),
  business: of('business'),
})

// The wording is left out of the comparison (withoutWording), so any language's copy will do.
const { BENEFITS, LIMITS, PLANS } = plansIn(defaultLocale)

function limit(key: LimitKey) {
  const { unit, scope, values } = LIMITS[key]
  return {
    unit,
    // Every *_per_month allowance starts again on the first of the month, UTC; the others are standing caps.
    period: key.endsWith('_per_month') ? 'calendar_month_utc' : null,
    per_person: scope === 'person',
    plans: perPlan((id) => ({ included: values[id] !== null, value: values[id] ?? 0 })),
  }
}

/** What plans.ts says the API publishes, without the offer's identity. */
export function projectPlans(): PublicOfferValues {
  const limitKeys = [...new Set([...BENEFITS.flatMap((b) => b.limitKeys), ...USAGE_DETAILS])]
  return {
    price_per: 'person',
    tax_inclusive: true,
    currencies: CURRENCIES,
    plans: PLANS.map((plan) => ({
      id: plan.id,
      name: plan.name,
      prices: Object.fromEntries(
        CURRENCIES.map((c) => [
          c,
          { month: priceOf(plan, 'month').amount, year: priceOf(plan, 'year').amount },
        ]),
      ),
    })),
    comparison: BENEFITS.map((b) => ({
      key: b.key,
      label: b.label,
      note: b.note,
      limit_keys: b.limitKeys,
      plans: perPlan((id) => b.cell(id) !== null),
    })),
    usage_details: USAGE_DETAILS,
    max_self_service_seats: perPlan(() => MAX_SELF_SERVICE_SEATS),
    limits: Object.fromEntries(limitKeys.map((key) => [key, limit(key)])),
  }
}

const definedKeys = (o: object) => Object.keys(o).filter((k) => Reflect.get(o, k) !== undefined)

/** JSON equality: key order and absent or undefined properties do not matter. */
export function sameJSON(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = definedKeys(a)
  return (
    ka.length === definedKeys(b).length &&
    ka.every((k) => sameJSON(Reflect.get(a, k), Reflect.get(b, k)))
  )
}

/**
 * The offer without its English wording (plan names, comparison labels and notes): a build in another language words
 * them in its own catalog. offer.test.ts pins the English wording to the golden file instead.
 */
function withoutWording(values: object): unknown {
  return JSON.parse(JSON.stringify(values), (key: string, value: unknown) =>
    key === 'name' || key === 'label' || key === 'note' ? undefined : value,
  )
}

/** Whether an API response body confirms what this build shows. */
export function confirms(body: unknown): boolean {
  const data: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'data') : null
  if (typeof data !== 'object' || data === null || !('offer_id' in data)) return false
  const values = { ...data }
  for (const key of IDENTITY) Reflect.deleteProperty(values, key)
  return sameJSON(withoutWording(values), withoutWording(projectPlans()))
}

export type OfferStatus = 'pending' | 'current' | 'unavailable'
export type Offer = { status: OfferStatus; checking: boolean; retry: () => void }

/**
 * Asks the API once on mount, and again on retry. 'unavailable' when it cannot be reached, answers with an error or
 * bad JSON, or publishes other values than this build (the site was built against another offer).
 */
export function useOffer(): Offer {
  const [status, setStatus] = useState<OfferStatus>('pending')
  const [checking, setChecking] = useState(true)
  const load = useCallback(
    (signal?: AbortSignal) =>
      fetch(OFFER_URL, { signal, cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => setStatus(confirms(body) ? 'current' : 'unavailable'))
        .catch(() => {
          if (!signal?.aborted) setStatus('unavailable')
        })
        .finally(() => {
          if (!signal?.aborted) setChecking(false)
        }),
    [],
  )
  useEffect(() => {
    const ask = new AbortController()
    void load(ask.signal)
    return () => ask.abort()
  }, [load])
  // The status stays while checking again, so a retry never flashes the build's prices back.
  const retry = useCallback(() => {
    setChecking(true)
    void load()
  }, [load])
  return useMemo(() => ({ status, checking, retry }), [status, checking, retry])
}
