'use client'

// Plans, usage and Stripe billing, typed by hand from docs/billing-contract.md.
import { meterTone } from '@helvetly/ui/components/meter'
import { formatPrice, monthOf, type Price } from '@helvetly/ui/lib/price'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, request } from '@/lib/api'

export type PlanId = 'basic' | 'pro' | 'business'
export type Interval = 'month' | 'year'
export type LimitKey =
  | 'members'
  | 'clients'
  | 'invoices_per_month'
  | 'expenses_per_month'
  | 'products'
  | 'engagements'
  | 'signatures_per_month'
  | 'storage_bytes'
  | 'ai_tokens_per_month'
  | 'employees'

/** A capability a plan switches on or off (apps/api/internal/billing/features.go). */
export type FeatureKey = 'api_access' | 'employees'

/** `null` is unlimited. */
export type UsageItem = { limit: LimitKey; used: number; max: number | null }
export type PlanPrice = Price
export { formatPrice, monthOf }
export type Plan = {
  id: PlanId
  name: string
  limits: Record<LimitKey, number | null>
  features: FeatureKey[]
  /** Per person (seat) for the interval. */
  prices: Record<Interval, PlanPrice | null>
}
export type Discount = {
  code: string
  percent_off: number | null
  amount_off: number | null
  currency: string | null
  duration: 'once' | 'repeating' | 'forever'
  duration_in_months: number | null
  ends_at: string | null
}
/** A checked promotion code; `plans: null` applies to every plan. */
export type Promotion = Omit<Discount, 'ends_at'> & {
  plans: PlanId[] | null
  expires_at: string | null
}
export type Billing = {
  enabled: boolean
  /** Billing on and no active plan: the workspace is read-only. */
  locked: boolean
  /** `''` when the workspace has no plan. */
  plan: PlanId | ''
  status: string
  interval: Interval | ''
  current_period_end: string | null
  cancel_at_period_end: boolean
  trial_end: string | null
  trial_days: number
  trial_plan: PlanId
  trial_available: boolean
  has_customer: boolean
  can_manage: boolean
  /** How the live subscription is billed; `''` without one (a new subscription is per seat). */
  pricing: 'per_seat' | 'flat' | ''
  /** People in the workspace now (owner, admins, members; open invitations not counted). */
  seats: number
  period_start: string
  discount: Discount | null
  usage: UsageItem[]
  /** What the workspace may use now: every feature without billing, none without a plan. */
  features: FeatureKey[]
  plans: Plan[]
  /** What the workspace pays in: `chf` in Switzerland and Liechtenstein, `eur` in the EU, `usd` elsewhere; an
   * existing Stripe customer keeps its own. Plan and pack prices are in it. */
  currency: string
  /** AI tokens bought this month; they add to the plan's monthly allowance and lapse with the month. */
  ai_tokens_bought: number
  /** The AI token packs on sale (empty without a plan, or for someone who cannot manage billing). */
  ai_packs: AIPack[]
  /** A payment of the workspace is in a chargeback that is not closed yet. */
  disputed: boolean
  /** The renewal stayed unpaid past the grace (three days after the paid period): read-only until it is paid. */
  payment_overdue: boolean
}
/** A one-time AI token pack: tokens for a price incl. VAT. */
export type AIPack = { tokens: number; amount: number; currency: string }
export type BillingInvoice = {
  id: string
  number: string
  date: string
  total: number
  currency: string
  status: string
  url: string
  pdf: string
}
export type BillingDetails = {
  payment_method: { brand: string; last4: string; exp_month: number; exp_year: number } | null
  invoices: BillingInvoice[]
}

/**
 * A billing path with the browser's time zone: the API prices in its currency when Cloudflare names no country and
 * the workspace's own zone says nothing (UTC).
 */
export const withZone = (path: string) =>
  `${path}?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`

export const billingKeys = {
  overview: ['billing'],
  details: ['billing', 'details'],
} as const

export function useBilling() {
  return useQuery({
    queryKey: billingKeys.overview,
    queryFn: async () => (await request<{ data: Billing }>(withZone('/billing'))).data,
  })
}

export function useBillingDetails(enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.details,
    queryFn: async () => (await request<{ data: BillingDetails }>('/billing/details')).data,
    enabled,
  })
}

/** Starts Checkout, or changes a live subscription in place; either way the answer is where to go next. */
export function useCheckout() {
  return useMutation<
    { url: string },
    ApiError,
    { plan: PlanId; interval: Interval; promotion_code?: string }
  >({
    mutationFn: (input) => request(withZone('/billing/checkout'), { method: 'POST', json: input }),
  })
}

/** Opens Checkout for one AI token pack; the answer is Checkout's URL. */
export function useBuyAITokens() {
  return useMutation<{ url: string }, ApiError, { tokens: number }>({
    mutationFn: (input) => request(withZone('/billing/ai-tokens'), { method: 'POST', json: input }),
  })
}

/** "1 M", "500 k", "900" tokens. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)} M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)} k`
  return `${tokens}`
}

/**
 * Checks a promotion code; a bad one is a 422 `promotion_code_invalid` whose message says why (`details.reason`:
 * invalid, currency, plan or has_discount). An amount off comes in the workspace's currency.
 */
export function usePromotionCode() {
  return useMutation<Promotion, ApiError, string>({
    mutationFn: async (code) =>
      (
        await request<{ data: Promotion }>(withZone('/billing/promotion-code'), {
          method: 'POST',
          json: { code },
        })
      ).data,
  })
}

/**
 * A 402 from a plan change charged at once (an upgrade, monthly to yearly, leaving the trial) whose payment didn't go
 * through: the plan stays as it was, the message says why, and `payUrl` is Stripe's page to confirm or pay it.
 */
export function paymentFailed(error: unknown): { message: string; payUrl: string | null } | null {
  if (!(error instanceof ApiError) || error.status !== 402 || error.code !== 'payment_failed')
    return null
  const url = error.details.pay_url
  return {
    message: error.message,
    payUrl: typeof url === 'string' && isStripeURL(url) ? url : null,
  }
}

/** An https link on a Stripe host: the only pages a pay link may open. */
const isStripeURL = (raw: string) => {
  try {
    const { protocol, hostname } = new URL(raw)
    return protocol === 'https:' && (hostname === 'stripe.com' || hostname.endsWith('.stripe.com'))
  } catch {
    return false
  }
}

/** A 402 from any change: the workspace has no active plan and is read-only. */
export const planRequired = (error: unknown) =>
  error instanceof ApiError && error.status === 402 && error.code === 'plan_required'

export function usePortal() {
  return useMutation<{ url: string }, ApiError, void>({
    mutationFn: () => request('/billing/portal', { method: 'POST' }),
  })
}

/** Reads the subscription from Stripe (back from Checkout, before the webhook lands). */
export function useSyncBilling() {
  const queryClient = useQueryClient()
  return useMutation<Billing, ApiError, void>({
    mutationFn: async () =>
      (await request<{ data: Billing }>(withZone('/billing/sync'), { method: 'POST' })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.overview, data)
      void queryClient.invalidateQueries({ queryKey: billingKeys.details })
    },
  })
}

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  api_access: 'API tokens',
  employees: 'Employees and payroll register',
}

/**
 * A feature the workspace's plan lacks, with the cheapest plan that unlocks it (null when none does); null while the
 * workspace may use it, or while billing has not answered (the API refuses the action anyway).
 */
export function lockedFeature(
  billing: Billing | undefined,
  feature: FeatureKey,
): { plan: Plan | null } | null {
  if (!billing || billing.features.includes(feature)) return null
  return { plan: billing.plans.find((plan) => plan.features.includes(feature)) ?? null }
}

/** `lockedFeature` for the signed-in workspace. */
export const useLockedFeature = (feature: FeatureKey) => lockedFeature(useBilling().data, feature)

/** A 402 from a create endpoint: the workspace's plan is full for that limit. */
export type LimitReached = { limit: LimitKey; used: number; max: number; plan: PlanId }

export function limitReached(error: unknown): LimitReached | null {
  if (!(error instanceof ApiError) || error.code !== 'limit_reached') return null
  const { limit, used, max, plan } = error.details
  if (!isLimitKey(limit) || !isPlanId(plan) || typeof used !== 'number' || typeof max !== 'number')
    return null
  return { limit, used, max, plan }
}

const LIMIT_KEYS: ReadonlySet<unknown> = new Set<LimitKey>([
  'members',
  'clients',
  'invoices_per_month',
  'expenses_per_month',
  'products',
  'engagements',
  'signatures_per_month',
  'storage_bytes',
  'ai_tokens_per_month',
  'employees',
])
const PLAN_IDS: ReadonlySet<unknown> = new Set<PlanId>(['basic', 'pro', 'business'])
const isLimitKey = (value: unknown): value is LimitKey => LIMIT_KEYS.has(value)
const isPlanId = (value: unknown): value is PlanId => PLAN_IDS.has(value)

export const LIMIT_LABELS: Record<LimitKey, string> = {
  members: 'Members',
  clients: 'Clients',
  invoices_per_month: 'Invoices this month',
  expenses_per_month: 'Expenses this month',
  products: 'Products & services',
  engagements: 'Running engagements',
  signatures_per_month: 'Signature requests this month',
  storage_bytes: 'Storage',
  ai_tokens_per_month: 'AI tokens this month',
  employees: 'Employees',
}

export function formatBytes(bytes: number): string {
  if (bytes >= 2 ** 40) return `${+(bytes / 2 ** 40).toFixed(1)} TB`
  if (bytes >= 1 << 30) return `${+(bytes / (1 << 30)).toFixed(1)} GB`
  if (bytes >= 1 << 20) return `${Math.round(bytes / (1 << 20))} MB`
  if (bytes >= 1 << 10) return `${Math.round(bytes / (1 << 10))} KB`
  return `${bytes} B`
}

/** A limit's value as people read it: "10", "500 MB", "Unlimited". */
export function formatLimit(limit: LimitKey, value: number | null): string {
  if (value === null) return 'Unlimited'
  return limit === 'storage_bytes' ? formatBytes(value) : value.toLocaleString('de-CH')
}

/** How full a meter is, on the meter's own thresholds: fine, almost at the limit (75 %), at it. */
export function meterState(item: UsageItem): 'ok' | 'near' | 'full' {
  if (item.max === null) return 'ok'
  if (item.used >= item.max) return 'full'
  return meterTone(item.used, item.max) === 'brand' ? 'ok' : 'near'
}

/** "1 person", "3 people". */
export const people = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`

/** A per-person price for that many people. */
export const seatsCost = (price: PlanPrice, seats: number): PlanPrice => ({
  ...price,
  amount: price.amount * seats,
})

/** What one more (or one fewer) person costs on the live per-seat subscription; null otherwise. */
export function seatPrice(billing: Billing): PlanPrice | null {
  if (billing.pricing !== 'per_seat' || billing.plan === '' || billing.interval === '') return null
  return billing.plans.find((plan) => plan.id === billing.plan)?.prices[billing.interval] ?? null
}

/** What the live per-seat subscription charges for the people in the workspace now; null otherwise. */
export function seatTotal(billing: Billing): PlanPrice | null {
  const price = seatPrice(billing)
  return price && seatsCost(price, billing.seats)
}

/** One person's price as a line: "CHF 49 / month incl. VAT"; null unless billing is on and per seat. */
export function seatCostLabel(billing: Billing): string | null {
  const price = seatPrice(billing)
  return billing.enabled && price
    ? `${formatPrice(price)} / ${billing.interval} ${taxNote(price.currency)}`
    : null
}

/** What a price includes, short: VAT in francs and euros, sales tax (where due) in dollars. */
export function taxNote(currency: string): string {
  return currency === 'usd' ? 'incl. tax' : 'incl. VAT'
}

/** The same, naming Swiss VAT for francs: "incl. Swiss VAT", "incl. VAT", "incl. tax". */
export function taxNoteLong(currency: string): string {
  return currency === 'chf' ? 'incl. Swiss VAT' : taxNote(currency)
}

const RANK: Record<PlanId | '', number> = { '': 0, basic: 1, pro: 2, business: 3 }
export const isUpgrade = (from: PlanId | '', to: PlanId) => RANK[to] > RANK[from]

/** Whether the code covers the plan. */
export const promoApplies = (promo: Promotion | Discount, plan: PlanId) =>
  !('plans' in promo) || promo.plans === null || promo.plans.includes(plan)

/** The price after the code, in minor units (never below zero); an amount off counts in its own currency only. */
export function discounted(
  price: PlanPrice,
  promo: Pick<Discount, 'percent_off' | 'amount_off' | 'currency'>,
): PlanPrice {
  if (promo.percent_off)
    return { ...price, amount: Math.round((price.amount * (100 - promo.percent_off)) / 100) }
  if (promo.amount_off && promo.currency === price.currency)
    return { ...price, amount: Math.max(0, price.amount - promo.amount_off) }
  return price
}

/** "−20 % for 3 months", "−CHF 10 once", "−20 % forever". */
export function describeDiscount(
  promo: Pick<
    Discount,
    'percent_off' | 'amount_off' | 'currency' | 'duration' | 'duration_in_months'
  >,
): string {
  const off = promo.percent_off
    ? `−${promo.percent_off} %`
    : `−${formatPrice({ amount: promo.amount_off ?? 0, currency: promo.currency ?? 'chf' })}`
  if (promo.duration === 'forever') return `${off} forever`
  if (promo.duration === 'once') return `${off} once`
  const months = promo.duration_in_months ?? 1
  return `${off} for ${months} ${months === 1 ? 'month' : 'months'}`
}

/** The yearly saving against twelve monthly payments, in whole percent (0 when unknown). */
export function yearlySaving(plan: Plan): number {
  const { month, year } = plan.prices
  if (!month || !year || month.amount === 0) return 0
  return Math.round((1 - year.amount / (month.amount * 12)) * 100)
}

/** The plan one step above the workspace's, if there is one (none without a plan). */
export function nextPlan(billing: Billing): Plan | undefined {
  if (billing.plan === '') return undefined
  const current = billing.plan
  return billing.plans.find((plan) => isUpgrade(current, plan.id))
}

/** Per-seat plans have no member cap. */
export const ANY_PEOPLE = 'Any number of people'

const HIGHLIGHT_ORDER: LimitKey[] = [
  'members',
  'clients',
  'invoices_per_month',
  'signatures_per_month',
  'engagements',
  'storage_bytes',
  'products',
  'expenses_per_month',
  'ai_tokens_per_month',
]
const HIGHLIGHT_NOUNS: Record<LimitKey, string> = {
  members: 'members',
  clients: 'clients',
  invoices_per_month: 'invoices a month',
  expenses_per_month: 'expenses a month',
  products: 'products & services',
  engagements: 'running engagements',
  signatures_per_month: 'signature requests a month',
  storage_bytes: 'storage',
  ai_tokens_per_month: 'AI tokens a month',
  employees: 'employees',
}

/** A plan's main limits as short lines: "2 members", "50 clients", "30 invoices a month". */
export function planHighlights(plan: Plan, count = 4): string[] {
  return HIGHLIGHT_ORDER.slice(0, count).map((limit) => {
    const value = plan.limits[limit]
    if (limit === 'members' && value === null) return ANY_PEOPLE
    return value === null
      ? `Unlimited ${HIGHLIGHT_NOUNS[limit]}`
      : `${formatLimit(limit, value)} ${HIGHLIGHT_NOUNS[limit]}`
  })
}

/** Whole days left in a trial, rounding up; 0 on its last day. */
export function trialDaysLeft(trialEnd: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(trialEnd) - now) / 86_400_000))
}

/**
 * The live billing period: its start (one interval before its end), its end and the days left,
 * for the renewal bar. Null without a period end or an interval.
 */
export function billingPeriod(
  billing: Pick<Billing, 'current_period_end' | 'interval'>,
  now = Date.now(),
): { start: number; end: number; days: number; left: number } | null {
  if (!billing.current_period_end || billing.interval === '') return null
  const end = Date.parse(billing.current_period_end)
  if (Number.isNaN(end)) return null
  const from = new Date(end)
  if (billing.interval === 'year') from.setUTCFullYear(from.getUTCFullYear() - 1)
  else from.setUTCMonth(from.getUTCMonth() - 1)
  const start = from.getTime()
  const days = Math.max(1, Math.round((end - start) / 86_400_000))
  const left = Math.min(days, Math.max(0, Math.ceil((end - now) / 86_400_000)))
  return { start, end, days, left }
}

/** What the plan costs per interval now: per seat × people, or the legacy flat price; null without one. */
export function planTotal(billing: Billing): PlanPrice | null {
  const total = seatTotal(billing)
  if (total) return total
  if (billing.pricing !== 'flat' || billing.plan === '' || billing.interval === '') return null
  return billing.plans.find((plan) => plan.id === billing.plan)?.prices[billing.interval] ?? null
}

/**
 * The next charge as far as the overview knows it: the plan's total (after a running discount) on
 * the trial's or the period's end. `ends` when the plan is cancelled (nothing more is charged);
 * null without a plan or a date. Proration and taxes beyond the incl.-VAT price are Stripe's.
 */
export function nextCharge(
  billing: Billing,
):
  | { kind: 'trial' | 'renewal'; amount: PlanPrice | null; date: string }
  | { kind: 'ends'; date: string }
  | null {
  if (billing.plan === '') return null
  const trial = billing.status === 'trialing' && billing.trial_end
  const date = trial ? billing.trial_end : billing.current_period_end
  if (!date) return null
  if (billing.cancel_at_period_end) return { kind: 'ends', date }
  const total = planTotal(billing)
  return {
    kind: trial ? 'trial' : 'renewal',
    amount: total && billing.discount ? discounted(total, billing.discount) : total,
    date,
  }
}

/** Whether the subscription's promotion code makes the plan cost nothing for good. */
export function freeForever(billing: Billing): boolean {
  const discount = billing.discount
  if (discount?.duration !== 'forever') return false
  const charge = nextCharge(billing)
  return discount.percent_off === 100 || (charge?.kind !== 'ends' && charge?.amount?.amount === 0)
}
