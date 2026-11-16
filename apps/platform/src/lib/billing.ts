'use client'
import { languageTag, numberLocale } from '@helvetly/i18n'
// Plans, usage and Stripe billing, typed by hand from docs/billing-contract.md.
import { meterTone } from '@helvetly/ui/components/meter'
import { formatPrice, monthOf, type Price } from '@helvetly/ui/lib/price'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, request } from '@/lib/api'
import { translate } from '@/lib/i18n'

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

/** A capability a plan switches on or off that the app gates (a record of kind access in the offer). */
export type FeatureKey =
  | 'api_access'
  | 'heidi'
  | 'expenses'
  | 'ai_import'
  | 'document_templates'
  | 'simple_signatures'
  | 'invoice_corrections'
  | 'vat_returns'
  | 'ledger_exports'
  | 'data_export'
  | 'automations'
  | 'client_portal'
  | 'einvoice_xml'
  | 'employees'

/**
 * One meter of the usage panel. `limit` is the API's key (any limit, not only `LimitKey`); `max` null is unlimited
 * and 0 is not included; `used` null while the API does not count it yet.
 */
export type UsageItem = {
  limit: string
  used: number | null
  max: number | null
  /** Grows with every paid person, one pool for the workspace; else a fixed cap for the workspace. */
  per_seat?: boolean
  /** An operator's value for this workspace instead of the plan's, and when it ends (null: no end). */
  custom?: { expires_at: string | null }
  /** When a monthly count starts again. */
  reset_at?: string | null
}

/** A workspace's effective value of one feature or limit (`entitlements` in GET /api/v1/billing). */
export type Entitlement = {
  key: string
  kind: 'access' | 'resource_state' | 'period_counter' | 'technical_guard'
  unit: string
  scope: string
  period: string | null
  state: 'enabled' | 'disabled' | 'limited' | 'unlimited' | 'missing'
  /** The cap when limited, else null. */
  value: number | null
  per_seat: boolean
  /** plan, workspace (an operator's value) or none (the offer has no value). */
  source: 'plan' | 'workspace' | 'none'
  expires_at: string | null
  used: number | null
  reset_at: string | null
}
export type PlanPrice = Price
export { formatPrice, monthOf }
export type Plan = {
  id: PlanId
  name: string
  limits: Record<LimitKey, number | null>
  /** Every feature the plan includes, gated or not. */
  features: string[]
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
  /** The plan whose features a trial gives (Business); only its checkout starts a trial. */
  trial_plan: PlanId
  /** The most people a workspace may have to start the trial. */
  trial_seats: number
  trial_available: boolean
  /** The workspace is in its trial: its allowances last the whole trial, never reset and do not grow with people. */
  trial: boolean
  has_customer: boolean
  can_manage: boolean
  /** How the live subscription is billed; `''` without one (a new subscription is per seat). */
  pricing: 'per_seat' | 'flat' | ''
  /** People in the workspace now (owner, admins, members; open invitations not counted). */
  seats: number
  /** The seats the per-seat subscription bills; null without one. */
  paid_seats: number | null
  /** A downgrade or yearly→monthly switch scheduled for the paid period's end, and when; null without one. */
  pending_plan: PlanId | null
  pending_interval: Interval | null
  pending_at: string | null
  period_start: string
  discount: Discount | null
  /** The earlier usage list; `entitlements` replaces it where the workspace has a plan. */
  usage: { limit: LimitKey; used: number; max: number | null }[]
  /** What the workspace may use now: every feature without billing, none without a plan. */
  features: string[]
  /** The offer the workspace's plan comes from; null without a plan. */
  offer_id?: string | null
  /** The workspace's effective features and limits with their use; null without a plan (and self-hosted). */
  entitlements?: Entitlement[] | null
  plans: Plan[]
  /** What the workspace pays in: `chf` in Switzerland and Liechtenstein, `eur` in the EU, `usd` elsewhere; an
   * existing Stripe customer keeps its own. Plan prices are in it. */
  currency: string
  /** AI tokens from packs bought this month (packs are no longer sold); they add to the plan's allowance. */
  ai_tokens_bought: number
  /** A payment of the workspace is in a chargeback that is not closed yet. */
  disputed: boolean
  /** The renewal stayed unpaid past the grace (three days after the paid period): read-only until it is paid. */
  payment_overdue: boolean
}
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

/** The offer on sale, as the public pricing page reads it: the business comparison and allowances for one person. */
export type PublicOffer = {
  offer_id: string
  comparison: {
    key: string
    label: string
    note?: string
    limit_keys: string[]
    plans: Record<PlanId, boolean>
  }[]
  usage_details: string[]
  limits: Record<
    string,
    {
      unit: string
      period: string | null
      /** Each paid person adds the value to one pool; else a fixed cap for the workspace. */
      per_person: boolean
      plans: Record<PlanId, { included: boolean; value: number | null }>
    }
  >
}

/** GET /api/v1/public/offers/current: the same catalogue as the website, for the plan comparison. */
export function usePublicOffer() {
  return useQuery({
    queryKey: ['offers', 'current'],
    queryFn: async () => (await request<{ data: PublicOffer }>('/public/offers/current')).data,
    staleTime: 5 * 60_000,
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

/** A 403 from a module the workspace's plan does not include; `details` names the feature and the plan that has it. */
export const featureNotInPlan = (error: unknown) =>
  error instanceof ApiError && error.status === 403 && error.code === 'feature_not_in_plan'
/**
 * A change the plan does not allow: a 402 `plan_required` (no plan, or an earlier feature gate) or a 403
 * `feature_not_in_plan`, with the feature and the cheapest plan that has it when the API names them.
 */
export function planRefusal(
  error: unknown,
): { message: string; feature: string | null; requiredPlan: PlanId | null } | null {
  if (!(error instanceof ApiError)) return null
  if (!planRequired(error) && !featureNotInPlan(error)) return null
  const { feature, required_plan } = error.details
  return {
    message: error.message,
    feature: typeof feature === 'string' ? feature : null,
    requiredPlan: isPlanId(required_plan) ? required_plan : null,
  }
}

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

/** Each gated feature as a sentence names it: "Your plan doesn’t include expenses". */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  api_access: translate('apiTokens'),
  heidi: translate('heidi'),
  expenses: translate('expenses3'),
  ai_import: translate('aiReceiptImport'),
  document_templates: translate('documentTemplates'),
  simple_signatures: translate('signatures2'),
  invoice_corrections: translate('invoiceCorrections'),
  vat_returns: translate('vatReturns'),
  ledger_exports: translate('theLedger'),
  data_export: translate('dataExports'),
  automations: translate('automations'),
  client_portal: translate('theClientPortal'),
  einvoice_xml: translate('eInvoiceXML2'),
  employees: translate('employeesModule'),
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
export type LimitReached = { limit: string; used: number; max: number; reset_at: string | null }

/**
 * A `limit_reached`, in the earlier body (`limit` the key, `max` the cap) or offer v2's (`key`, `limit` the cap,
 * `reset_at`).
 */
export function limitReached(error: unknown): LimitReached | null {
  if (!(error instanceof ApiError) || error.code !== 'limit_reached') return null
  const { key, limit, used, max, reset_at } = error.details
  const name = typeof key === 'string' ? key : limit
  const cap = typeof max === 'number' ? max : limit
  if (typeof name !== 'string' || typeof used !== 'number' || typeof cap !== 'number') return null
  return { limit: name, used, max: cap, reset_at: typeof reset_at === 'string' ? reset_at : null }
}

const PLAN_IDS: ReadonlySet<unknown> = new Set<PlanId>(['basic', 'pro', 'business'])
const isPlanId = (value: unknown): value is PlanId => PLAN_IDS.has(value)

export const LIMIT_LABELS: Record<LimitKey, string> = {
  members: translate('members'),
  clients: translate('clients'),
  invoices_per_month: translate('invoicesThisMonth'),
  expenses_per_month: translate('expensesThisMonth'),
  products: translate('productsServices'),
  engagements: translate('runningEngagements2'),
  signatures_per_month: translate('signatureRequestsThisMonth'),
  storage_bytes: translate('storage'),
  ai_tokens_per_month: translate('aiTokensThisMonth'),
}

const limitNounMessages = {
  members: 'limitNounMembers',
  clients: 'limitNounClients',
  invoices_per_month: 'limitNounInvoicesPerMonth',
  expenses_per_month: 'limitNounExpensesPerMonth',
  products: 'limitNounProducts',
  engagements: 'limitNounEngagements',
  signatures_per_month: 'limitNounSignaturesPerMonth',
  storage_bytes: 'limitNounStorageBytes',
  ai_tokens_per_month: 'limitNounAiTokensPerMonth',
} as const

export function limitNoun(key: LimitKey, count = 2): string {
  return translate(limitNounMessages[key], { count })
}

/** A limit's noun as offer v2 names it: invoice issues and active engagements, the rest as `limitNoun`. */
export function offerNoun(key: LimitKey, count = 2): string {
  if (key === 'invoices_per_month') return translate('limitNounInvoiceIssues', { count })
  if (key === 'engagements') return translate('limitNounActiveEngagements', { count })
  return limitNoun(key, count)
}

export function limitFactLabel(key: LimitKey, count = 2): string {
  const noun = limitNoun(key, count)
  return key.endsWith('_per_month') ? translate('monthlyLimitFact', { noun }) : noun
}

export function comparisonLimitLabel(key: LimitKey): string {
  const monthly: Partial<Record<LimitKey, string>> = {
    invoices_per_month: translate('invoicesPerMonthLabel'),
    expenses_per_month: translate('expensesPerMonthLabel'),
    signatures_per_month: translate('signaturesPerMonthLabel'),
    ai_tokens_per_month: translate('aiTokensPerMonthLabel'),
  }
  return monthly[key] ?? LIMIT_LABELS[key]
}

/** Whether an API key is one of the limits plans list. */
export const isLimitKey = (key: string): key is LimitKey => Object.hasOwn(LIMIT_LABELS, key)

/** The usage panel's names for every customer allowance of offer v2 (monthly ones say so). */
const USAGE_LABELS: Record<string, string> = {
  ...LIMIT_LABELS,
  invoices_per_month: translate('invoiceIssuesThisMonth'),
  engagements: translate('activeEngagements'),
  download_bytes_per_month: translate('fileDownloadsThisMonth'),
  emails_per_month: translate('emailRecipientsThisMonth'),
  email_attachment_bytes_per_month: translate('emailAttachmentsThisMonth'),
  automation_actions_per_month: translate('automationActionsThisMonth'),
  drafts: translate('drafts'),
  retained_quotes: translate('keptQuotes'),
}

/** A limit's name: "Clients", "Invoice issues this month"; an unknown key reads as its words. */
export const usageLabel = (key: string) =>
  USAGE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')

/** Decimal, as the plans are sold: 1 GB = 1'000 MB. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${+(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${+(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
  return `${bytes} B`
}

const isBytes = (key: string) => /(^|_)bytes(_|$)/.test(key)

/** A limit's value as people read it: "10", "500 MB", "Unlimited". */
export function formatLimit(limit: string, value: number | null): string {
  if (value === null) return translate('unlimited2')
  return isBytes(limit) ? formatBytes(value) : value.toLocaleString(numberLocale)
}

/**
 * How full a meter is, on the meter's own thresholds: fine, almost at the limit (75 %), at it; `off` when the plan
 * does not include it.
 */
export function meterState(item: UsageItem): 'ok' | 'near' | 'full' | 'off' {
  if (item.max === 0) return 'off'
  if (item.max === null || item.used === null) return 'ok'
  if (item.used >= item.max) return 'full'
  return meterTone(item.used, item.max) === 'brand' ? 'ok' : 'near'
}

/** Allowances a customer reads in the panel: counts and pools, not features, cost guards or the seat count. */
const shownInPanel = (e: Entitlement) =>
  (e.kind === 'resource_state' || e.kind === 'period_counter') && e.key !== 'seats'

/**
 * The usage panel's meters: the workspace's entitlements, in the offer's order; the earlier `usage` list where there
 * are none (no plan, self-hosted). A missing value is shown as none (nothing new may be spent).
 */
export function usageItems(billing: Billing): UsageItem[] {
  if (!billing.entitlements) return billing.usage
  return billing.entitlements.filter(shownInPanel).map((e) => ({
    limit: e.key,
    used: e.used,
    max: e.state === 'unlimited' ? null : (e.value ?? 0),
    per_seat: e.per_seat,
    custom: e.source === 'workspace' ? { expires_at: e.expires_at } : undefined,
    reset_at: e.reset_at,
  }))
}

/** When a monthly allowance starts again, in UTC: "1 Dec, 00:00 UTC". */
export function formatReset(iso: string): string {
  const at = new Intl.DateTimeFormat(languageTag, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(iso))
  return `${at} UTC`
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
  return currency === 'usd' ? translate('inclTax') : translate('inclVAT3')
}

/** The same, naming Swiss VAT for francs: "incl. Swiss VAT", "incl. VAT", "incl. tax". */
export function taxNoteLong(currency: string): string {
  return currency === 'chf' ? translate('inclSwissVAT') : taxNote(currency)
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
  if (promo.duration === 'forever') return translate('dynamicForever', { off: off })
  if (promo.duration === 'once') return translate('dynamicOnce', { off: off })
  const months = promo.duration_in_months ?? 1
  return translate('dynamicFor2', {
    off: off,
    months: months,
    value3: months === 1 ? translate('dynamicMonth') : translate('dynamicMonths'),
  })
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
export const ANY_PEOPLE = translate('anyNumberOfPeople')

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
  invoices_per_month: translate('invoicesAMonth'),
  expenses_per_month: translate('expensesAMonth'),
  products: translate('productsServices2'),
  engagements: translate('runningEngagements'),
  signatures_per_month: translate('signatureRequestsAMonth'),
  storage_bytes: 'storage',
  ai_tokens_per_month: translate('aiTokensAMonth'),
}

/** A plan's main limits as short lines: "2 members", "50 clients", "30 invoices a month". */
export function planHighlights(plan: Plan, count = 4): string[] {
  return HIGHLIGHT_ORDER.slice(0, count).map((limit) => {
    const value = plan.limits[limit]
    if (limit === 'members' && value === null) return ANY_PEOPLE
    return value === null
      ? translate('unlimited4', { value1: HIGHLIGHT_NOUNS[limit] })
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
