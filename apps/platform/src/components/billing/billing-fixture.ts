import { PLAN_IDS, type PlanId as CatalogueId } from '@helvetly/ui/lib/plan-features'
import { yearOf } from '@helvetly/ui/lib/price'

import type { Billing, Entitlement, FeatureKey, LimitKey, PlanId, PublicOffer } from '@/lib/billing'

import publicOffer from './public-offer.fixture.json'

const GB = 1_000_000_000
// One person's values of offer helvetly-v1 (the offer document of migration 00065); 0 is not included, null
// unlimited; members: the people besides the owner a plan sells (max_self_service_seats − 1).
const free: Record<LimitKey, number | null> = {
  members: 0,
  clients: 5,
  invoices_per_month: 3,
  quotes_per_month: 3,
  expenses_per_month: 1,
  products: 10,
  engagements: 1,
  signatures_per_month: 0,
  storage_bytes: GB / 10,
  ai_tokens_per_month: 0,
  ai_automation_tokens_per_month: 0,
}
const basic: Record<LimitKey, number | null> = {
  members: 4,
  clients: 30,
  invoices_per_month: 15,
  quotes_per_month: 5,
  expenses_per_month: 10,
  products: 25,
  engagements: 3,
  signatures_per_month: 0,
  storage_bytes: GB / 2,
  ai_tokens_per_month: 0,
  ai_automation_tokens_per_month: 0,
}
const pro: Record<LimitKey, number | null> = {
  members: 24,
  clients: 300,
  invoices_per_month: 100,
  quotes_per_month: 100,
  expenses_per_month: 300,
  products: 250,
  engagements: 20,
  signatures_per_month: 50,
  storage_bytes: 5 * GB,
  ai_tokens_per_month: 5_000_000,
  ai_automation_tokens_per_month: 5_000_000,
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
  ai_automation_tokens_per_month: 20_000_000,
}
type Gated = FeatureKey | 'invoice_instalments' | 'remove_branding'
// Gated features every plan has (Free too), what every paid plan adds, then the ones Pro and Business add.
const ALL_FEATURES: Gated[] = ['expenses', 'scheduling']
const PAID_FEATURES: Gated[] = [...ALL_FEATURES, 'calendar_sync']
const PRO_FEATURES: Gated[] = [
  ...PAID_FEATURES,
  'api_access',
  'heidi',
  'ai_import',
  'document_templates',
  'simple_signatures',
  'invoice_corrections',
  'invoice_instalments',
  'vat_returns',
  'ledger_exports',
  'data_export',
  'automations',
  'engagement_automation',
  'remove_branding',
]
const features: Record<PlanId | 'free', Gated[]> = {
  free: ALL_FEATURES,
  basic: PAID_FEATURES,
  pro: PRO_FEATURES,
  business: [
    ...PRO_FEATURES,
    'client_portal',
    'custom_portal_domain',
    'document_approvals',
    'einvoice_xml',
    'employees',
  ],
}
/** A plan's tiered prices: `month` for its included people, each further one `extra` (offer helvetly-v1). */
const prices = (month: number, included: number, extra: number, currency: string) => ({
  month: { amount: month, currency, included_people: included, extra_person: extra },
  year: {
    amount: yearOf({ amount: month, currency }).amount,
    currency,
    included_people: included,
    extra_person: yearOf({ amount: extra, currency }).amount,
  },
})

/**
 * `GET /api/v1/billing` for a workspace on Free (no paid plan); paid plans priced as offer helvetly-v1. With billing
 * off (`enabled: false`) as a self-hosted installation answers: no plan and every feature.
 */
export const billingFixture = (over: Partial<Billing> = {}): Billing => ({
  currency: 'chf',
  enabled: true,
  locked: false,
  plan: over.enabled === false ? '' : 'free',
  status: '',
  interval: '',
  current_period_end: null,
  cancel_at_period_end: false,
  trial_end: null,
  trial_days: 14,
  trial_plan: 'pro',
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
  features: over.enabled === false ? features.business : features[over.plan || 'free'],
  ai_tokens_bought: 0,
  disputed: false,
  payment_overdue: false,
  plans: [
    {
      id: 'basic',
      name: 'Basic',
      limits: basic,
      features: features.basic,
      prices: prices(1900, 1, 1000, over.currency ?? 'chf'),
    },
    {
      id: 'pro',
      name: 'Pro',
      limits: pro,
      features: features.pro,
      prices: prices(4900, 2, 1500, over.currency ?? 'chf'),
    },
    {
      id: 'business',
      name: 'Business',
      limits: business,
      features: features.business,
      prices: prices(14900, 5, 2000, over.currency ?? 'chf'),
    },
  ],
  ...over,
})

/** No plan at all, not even Free: read-only. The API no longer answers it; the plan gate still guards it. */
export const noPlanBillingFixture = (over: Partial<Billing> = {}): Billing =>
  billingFixture({ plan: '', locked: true, features: [], ...over })

/** Free's limits, for a workspace on it (the overview's `usage` maxes come from the Free plan). */
export const FREE_LIMITS = free

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
  values: Record<PlanId | 'free', number | null>,
]

// The allowances of offer helvetly-v1 for one person, in the offer's order, as GET /api/v1/billing lists them.
const ALLOWANCES: Allowance[] = [
  ['clients', 'resource_state', false, { free: 5, basic: 30, pro: 300, business: null }],
  ['products', 'resource_state', false, { free: 10, basic: 25, pro: 250, business: null }],
  ['engagements', 'resource_state', false, { free: 1, basic: 3, pro: 20, business: null }],
  ['invoices_per_month', 'period_counter', true, { free: 3, basic: 15, pro: 100, business: null }],
  ['quotes_per_month', 'period_counter', true, { free: 3, basic: 5, pro: 100, business: null }],
  ['expenses_per_month', 'period_counter', true, { free: 1, basic: 10, pro: 300, business: null }],
  ['signatures_per_month', 'period_counter', true, { free: 0, basic: 0, pro: 50, business: null }],
  [
    'storage_bytes',
    'resource_state',
    true,
    { free: GB / 10, basic: GB / 2, pro: 5 * GB, business: 20 * GB },
  ],
  ['emails_per_month', 'period_counter', true, { free: 20, basic: 100, pro: 500, business: 2000 }],
  [
    'ai_tokens_per_month',
    'period_counter',
    true,
    { free: 0, basic: 0, pro: 5_000_000, business: 20_000_000 },
  ],
  [
    'ai_automation_tokens_per_month',
    'period_counter',
    true,
    { free: 0, basic: 0, pro: 5_000_000, business: 20_000_000 },
  ],
  [
    'automation_actions_per_month',
    'period_counter',
    true,
    { free: 0, basic: 0, pro: 1500, business: 6000 },
  ],
]

/**
 * `entitlements` of a workspace on `plan` with `seats` paid seats: every pooled allowance grown by the seats, `used`
 * from `used` (0 otherwise), monthly ones resetting on 1 December 00:00 UTC; `over` replaces single items.
 */
export function entitlementsFixture(
  plan: PlanId | 'free',
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
    const planned: Entitlement = {
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
    }
    return Object.assign(planned, over[key])
  })
}

const isCatalogueId = (id: string): id is CatalogueId => (PLAN_IDS as string[]).includes(id)

/** GET /api/v1/public/offers/current of offer helvetly-v1, typed (the JSON is the API's golden file). */
export const publicOfferFixture: PublicOffer = {
  ...publicOffer,
  plans: publicOffer.plans.map((plan) => {
    if (!isCatalogueId(plan.id)) throw new Error(`unknown plan ${plan.id}`)
    return { ...plan, id: plan.id }
  }),
}
