import { yearOf } from '@helvetly/ui/lib/price'

import type { Billing, LimitKey } from '@/lib/billing'

const GB = 2 ** 30
// The limits seeded in apps/api/internal/store/migrations/00001_init.sql (plan_limits).
const basic: Record<LimitKey, number | null> = {
  members: null,
  clients: 50,
  invoices_per_month: 30,
  expenses_per_month: 60,
  products: 25,
  engagements: 3,
  signatures_per_month: 5,
  storage_bytes: 5 * GB,
  ai_tokens_per_month: 1_000_000,
}
const pro: Record<LimitKey, number | null> = {
  members: null,
  clients: 1000,
  invoices_per_month: 300,
  expenses_per_month: 600,
  products: 500,
  engagements: 50,
  signatures_per_month: 50,
  storage_bytes: 100 * GB,
  ai_tokens_per_month: 5_000_000,
}
const business: Record<LimitKey, number | null> = {
  members: null,
  clients: null,
  invoices_per_month: null,
  expenses_per_month: null,
  products: null,
  engagements: null,
  signatures_per_month: null,
  storage_bytes: 1024 * GB,
  ai_tokens_per_month: 20_000_000,
}
const prices = (month: number) => ({
  month: { amount: month, currency: 'chf' },
  year: yearOf({ amount: month, currency: 'chf' }),
})

/** `GET /api/v1/billing` for a workspace without a plan; plan prices are per person (docs/billing-contract.md). */
export const billingFixture = (over: Partial<Billing> = {}): Billing => ({
  enabled: true,
  locked: true,
  plan: '',
  status: '',
  interval: '',
  current_period_end: null,
  cancel_at_period_end: false,
  trial_end: null,
  trial_days: 7,
  trial_plan: 'basic',
  trial_available: true,
  has_customer: false,
  can_manage: true,
  pricing: '',
  seats: 3,
  period_start: '2026-11-01',
  discount: null,
  usage: [],
  ai_tokens_bought: 0,
  ai_packs: [],
  plans: [
    { id: 'basic', name: 'Basic', limits: basic, prices: prices(1900) },
    { id: 'pro', name: 'Pro', limits: pro, prices: prices(4900) },
    { id: 'business', name: 'Business', limits: business, prices: prices(9900) },
  ],
  ...over,
})

/** The member caps legacy flat subscriptions keep (the seeded limits before per-seat pricing). */
const FLAT_MEMBER_LIMITS = { basic: 2, pro: 10, business: null } as const

/** A legacy workspace on flat per-workspace prices: the plan prices are per workspace and members are capped. */
export const flatBillingFixture = (over: Partial<Billing> = {}): Billing => {
  const base = billingFixture({ pricing: 'flat', seats: 2, ...over })
  return {
    ...base,
    plans: base.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      prices: plan.prices,
      limits: { ...plan.limits, members: FLAT_MEMBER_LIMITS[plan.id] },
    })),
  }
}
