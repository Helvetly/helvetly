import { yearOf } from '@helvetly/ui/lib/price'

import type { Billing, Entitlement, FeatureKey, LimitKey, PlanId } from '@/lib/billing'

const GB = 1_000_000_000
// One seat's values of offer helvetly-v2 (apps/api/internal/store/migrations/00014_offer_v2.sql); 0 is not included,
// null unlimited (members: no cap on a per-seat price).
const basic: Record<LimitKey, number | null> = {
  members: null,
  clients: 30,
  invoices_per_month: 15,
  quotes_per_month: 5,
  expenses_per_month: 0,
  products: 25,
  engagements: 3,
  signatures_per_month: 0,
  storage_bytes: GB / 2,
  ai_tokens_per_month: 0,
}
const pro: Record<LimitKey, number | null> = {
  members: null,
  clients: 300,
  invoices_per_month: 100,
  quotes_per_month: 100,
  expenses_per_month: 300,
  products: 250,
  engagements: 20,
  signatures_per_month: 50,
  storage_bytes: 5 * GB,
  ai_tokens_per_month: 5_000_000,
}
const business: Record<LimitKey, number | null> = {
  members: null,
  clients: null,
  invoices_per_month: null,
  quotes_per_month: null,
  expenses_per_month: null,
  products: null,
  engagements: null,
  signatures_per_month: null,
  storage_bytes: 20 * GB,
  ai_tokens_per_month: 20_000_000,
}
const PRO_FEATURES: FeatureKey[] = [
  'api_access',
  'heidi',
  'expenses',
  'ai_import',
  'document_templates',
  'simple_signatures',
  'invoice_corrections',
  'vat_returns',
  'ledger_exports',
  'data_export',
  'automations',
]
// The gated features of offer helvetly-v2 per plan; the ones every plan has are left out.
const features: Record<PlanId, FeatureKey[]> = {
  basic: [],
  pro: PRO_FEATURES,
  business: [...PRO_FEATURES, 'client_portal', 'einvoice_xml', 'employees'],
}
const prices = (month: number, currency: string) => ({
  month: { amount: month, currency },
  year: yearOf({ amount: month, currency }),
})

/** `GET /api/v1/billing` for a workspace without a plan; plan prices are per person (docs/billing-contract.md). */
export const billingFixture = (over: Partial<Billing> = {}): Billing => ({
  currency: 'chf',
  enabled: true,
  locked: true,
  plan: '',
  status: '',
  interval: '',
  current_period_end: null,
  cancel_at_period_end: false,
  trial_end: null,
  trial_days: 7,
  trial_plan: 'business',
  trial_seats: 2,
  trial_available: true,
  trial: false,
  has_customer: false,
  can_manage: true,
  pricing: '',
  seats: 3,
  paid_seats: null,
  pending_plan: null,
  pending_interval: null,
  pending_at: null,
  period_start: '2026-11-01',
  discount: null,
  usage: [],
  features: over.plan ? features[over.plan] : [],
  ai_tokens_bought: 0,
  disputed: false,
  payment_overdue: false,
  plans: [
    {
      id: 'basic',
      name: 'Basic',
      limits: basic,
      features: features.basic,
      prices: prices(1900, over.currency ?? 'chf'),
    },
    {
      id: 'pro',
      name: 'Pro',
      limits: pro,
      features: features.pro,
      prices: prices(4900, over.currency ?? 'chf'),
    },
    {
      id: 'business',
      name: 'Business',
      limits: business,
      features: features.business,
      prices: prices(9900, over.currency ?? 'chf'),
    },
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
      features: plan.features,
      limits: { ...plan.limits, members: FLAT_MEMBER_LIMITS[plan.id] },
    })),
  }
}

type Allowance = [
  key: string,
  kind: Entitlement['kind'],
  perSeat: boolean,
  /** null: unlimited. */
  values: Record<PlanId, number | null>,
]

// The allowances of offer v3 for one seat, in the offer's order, as GET /api/v1/billing lists them.
const ALLOWANCES: Allowance[] = [
  ['clients', 'resource_state', false, { basic: 30, pro: 300, business: null }],
  ['products', 'resource_state', false, { basic: 25, pro: 250, business: null }],
  ['engagements', 'resource_state', false, { basic: 3, pro: 20, business: null }],
  ['invoices_per_month', 'period_counter', true, { basic: 15, pro: 100, business: null }],
  ['quotes_per_month', 'period_counter', true, { basic: 5, pro: 100, business: null }],
  ['expenses_per_month', 'period_counter', true, { basic: 0, pro: 300, business: null }],
  ['signatures_per_month', 'period_counter', true, { basic: 0, pro: 50, business: null }],
  ['storage_bytes', 'resource_state', true, { basic: GB / 2, pro: 5 * GB, business: 20 * GB }],
  [
    'download_bytes_per_month',
    'period_counter',
    true,
    { basic: 2 * GB, pro: 20 * GB, business: 100 * GB },
  ],
  ['emails_per_month', 'period_counter', true, { basic: 100, pro: 1000, business: 5000 }],
  [
    'ai_tokens_per_month',
    'period_counter',
    true,
    { basic: 0, pro: 5_000_000, business: 20_000_000 },
  ],
  ['automation_actions_per_month', 'period_counter', true, { basic: 0, pro: 1500, business: 6000 }],
]

/**
 * `entitlements` of a workspace on `plan` with `seats` paid seats: every pooled allowance grown by the seats, `used`
 * from `used` (0 otherwise), monthly ones resetting on 1 December 00:00 UTC; `over` replaces single items.
 */
export function entitlementsFixture(
  plan: PlanId,
  {
    seats = 1,
    used = {},
    over = {},
  }: {
    seats?: number
    used?: Record<string, number | null>
    over?: Record<string, Partial<Entitlement>>
  } = {},
): Entitlement[] {
  return ALLOWANCES.map(([key, kind, perSeat, values]) => {
    const value = values[plan]
    return {
      key,
      kind,
      unit: key.includes('bytes') ? 'byte' : key.includes('tokens') ? 'token' : 'count',
      scope: 'workspace',
      period: kind === 'period_counter' ? 'calendar_month_utc' : null,
      state: value === null ? ('unlimited' as const) : ('limited' as const),
      value: value !== null && perSeat ? value * seats : value,
      per_seat: perSeat && value !== null && value > 0,
      source: 'plan' as const,
      expires_at: null,
      used: used[key] === undefined ? 0 : used[key],
      reset_at: kind === 'period_counter' ? '2026-12-01T00:00:00Z' : null,
      ...over[key],
    }
  })
}
