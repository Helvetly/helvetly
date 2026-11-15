// The one place the website keeps what each plan costs and includes: offer v2's public projection (prices,
// the business comparison and the commercial allowances). Every page, card, table, FAQ and comparison reads it
// from here. Prices are checked against apps/api/internal/billing/plans.go in plans.test.ts.
// shortcut: these values are copied from the approved offer; once the API serves its public current-offer catalog,
// load them from there instead and keep only this module's shape.

import { type Price, YEARLY_DISCOUNT_PERCENT, yearOf } from '@helvetly/ui/lib/price'

export type PlanId = 'basic' | 'pro' | 'business'
export type Interval = 'month' | 'year'
export type PerPlan<T> = Record<PlanId, T>

export const PLAN_IDS: PlanId[] = ['basic', 'pro', 'business']

/** A product recommendation, not measured popularity. */
export const RECOMMENDED: PlanId = 'pro'

export { YEARLY_DISCOUNT_PERCENT }

/** Seats an owner can buy in the app; more on request. */
export const MAX_SELF_SERVICE_SEATS = 25

/**
 * A fixed cap for the whole workspace, or an amount each paid person adds to the workspace's one shared pool.
 * Monthly pools start again at 00:00 UTC on the first of the month.
 */
export type Scope = 'workspace' | 'person'
export type Unit = 'count' | 'bytes' | 'tokens'

/** The allowance keys as the API names them. */
export type LimitKey =
  | 'clients'
  | 'products'
  | 'engagements'
  | 'invoices_per_month'
  | 'expenses_per_month'
  | 'signatures_per_month'
  | 'storage_bytes'
  | 'download_bytes_per_month'
  | 'emails_per_month'
  | 'email_attachment_bytes_per_month'
  | 'ai_tokens_per_month'
  | 'automation_actions_per_month'

/** null: the plan does not include it. Bytes are decimal: 1 GB = 1'000 MB. */
export type Limit = { label: string; scope: Scope; unit: Unit; values: PerPlan<number | null> }

const MB = 1_000_000
const GB = 1_000_000_000

export const LIMITS: Record<LimitKey, Limit> = {
  clients: {
    label: 'Clients',
    scope: 'workspace',
    unit: 'count',
    values: { basic: 30, pro: 300, business: 1500 },
  },
  products: {
    label: 'Products and services',
    scope: 'workspace',
    unit: 'count',
    values: { basic: 25, pro: 250, business: 1000 },
  },
  engagements: {
    label: 'Active engagements',
    scope: 'workspace',
    unit: 'count',
    values: { basic: 3, pro: 20, business: 100 },
  },
  invoices_per_month: {
    label: 'New invoice issues a month',
    scope: 'person',
    unit: 'count',
    values: { basic: 15, pro: 150, business: 600 },
  },
  expenses_per_month: {
    label: 'Expenses a month',
    scope: 'person',
    unit: 'count',
    values: { basic: null, pro: 300, business: 1200 },
  },
  signatures_per_month: {
    label: 'Signature requests a month',
    scope: 'person',
    unit: 'count',
    values: { basic: null, pro: 50, business: 200 },
  },
  storage_bytes: {
    label: 'Document storage',
    scope: 'person',
    unit: 'bytes',
    values: { basic: 500 * MB, pro: 5 * GB, business: 20 * GB },
  },
  download_bytes_per_month: {
    label: 'File downloads a month',
    scope: 'person',
    unit: 'bytes',
    values: { basic: 2 * GB, pro: 20 * GB, business: 100 * GB },
  },
  emails_per_month: {
    label: 'Business email recipients a month',
    scope: 'person',
    unit: 'count',
    values: { basic: 100, pro: 1000, business: 5000 },
  },
  email_attachment_bytes_per_month: {
    label: 'Total email attachments a month',
    scope: 'person',
    unit: 'bytes',
    values: { basic: 100 * MB, pro: 1 * GB, business: 5 * GB },
  },
  ai_tokens_per_month: {
    label: 'AI tokens a month for available functions',
    scope: 'person',
    unit: 'tokens',
    values: { basic: 250_000, pro: 5_000_000, business: 20_000_000 },
  },
  automation_actions_per_month: {
    label: 'Automation actions a month',
    scope: 'person',
    unit: 'count',
    values: { basic: null, pro: 1500, business: 6000 },
  },
}

/** The allowances shown before purchase, in this order (engagements are in the comparison instead). */
export const USAGE_DETAILS: LimitKey[] = [
  'clients',
  'products',
  'invoices_per_month',
  'expenses_per_month',
  'signatures_per_month',
  'storage_bytes',
  'download_bytes_per_month',
  'emails_per_month',
  'email_attachment_bytes_per_month',
  'ai_tokens_per_month',
  'automation_actions_per_month',
]

/** The cheapest plan with each gated feature; everything else in the comparison is in every plan. */
const FEATURE_FROM = {
  heidi: 'pro',
  expenses: 'pro',
  templates_signatures: 'pro',
  corrections_vat: 'pro',
  ledger_exports: 'pro',
  automations: 'pro',
  client_portal: 'business',
  einvoice_xml: 'business',
} as const satisfies Record<string, PlanId>

export type Feature = keyof typeof FEATURE_FROM

export function has(plan: PlanId, feature: Feature): boolean {
  return PLAN_IDS.indexOf(plan) >= PLAN_IDS.indexOf(FEATURE_FROM[feature])
}

/** "Pro or Business", "Business": the plans a feature needs. */
export function plansWith(feature: Feature, joiner = ' or '): string {
  return PLAN_IDS.filter((id) => has(id, feature))
    .map((id) => PLAN_NAMES[id])
    .join(joiner)
}

/** Swiss thousands: 1’500. */
export const count = (n: number) => n.toLocaleString('en-US').replace(/,/g, '’')
/** Decimal megabytes and gigabytes: 500 MB, 5 GB. */
export const bytes = (n: number) => (n >= GB ? `${count(n / GB)} GB` : `${count(n / MB)} MB`)
/** Tokens in short: 250’000, 5M. */
export const tokens = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : count(n))

/** One allowance as the usage table shows it; null when the plan does not include it. */
export function formatLimit(key: LimitKey, plan: PlanId): string | null {
  const { unit, values } = LIMITS[key]
  const amount = values[plan]
  if (amount === null) return null
  return unit === 'bytes' ? bytes(amount) : count(amount)
}

function value(key: LimitKey, plan: PlanId): number {
  const v = LIMITS[key].values[plan]
  if (v === null) throw new Error(`${plan} has no ${key}`)
  return v
}

const perPerson = (key: LimitKey, what: string) => (plan: PlanId) =>
  LIMITS[key].values[plan] === null ? null : `${count(value(key, plan))} ${what}/person/month`

/** A comparison cell: what the plan gives, or null for not included. */
export type Benefit = {
  key: string
  label: string
  note?: string
  cell: (plan: PlanId) => string | null
}

const INCLUDED = 'Included'
const from = (feature: Feature) => (plan: PlanId) => (has(plan, feature) ? INCLUDED : null)

/** The twelve business benefits compared on the pricing page, in this order. */
export const BENEFITS: Benefit[] = [
  {
    key: 'invoicing',
    label: 'Invoices and quotes',
    cell: perPerson('invoices_per_month', 'new invoice issues'),
  },
  { key: 'swiss_qr', label: 'Swiss QR bills', cell: () => INCLUDED },
  {
    key: 'revolut',
    label: 'Revolut payment link',
    note: 'Your revolut.me link and QR code; the client enters the amount and reference shown. No bank synchronisation or automatic payment confirmation.',
    cell: () => INCLUDED,
  },
  {
    key: 'engagements',
    label: 'Engagements and retainers',
    note: 'Managed by hand in every plan; scheduled workflows need Pro or Business.',
    cell: (plan) =>
      `${count(value('engagements', plan))} active per workspace${has(plan, 'automations') ? '' : ', manual workflows'}`,
  },
  {
    key: 'automations',
    label: 'Automations and payment reminders',
    cell: perPerson('automation_actions_per_month', 'actions'),
  },
  {
    key: 'heidi',
    label: 'Heidi AI assistant',
    cell: (plan) =>
      has(plan, 'heidi')
        ? `Included; shared ${tokens(value('ai_tokens_per_month', plan))} AI tokens/person/month`
        : null,
  },
  { key: 'client_portal', label: 'Client portal', cell: from('client_portal') },
  {
    key: 'expenses',
    label: 'Expenses and AI receipt import',
    cell: perPerson('expenses_per_month', 'expenses'),
  },
  {
    key: 'documents_signatures',
    label: 'Document templates and simple signatures',
    cell: perPerson('signatures_per_month', 'signature requests'),
  },
  {
    key: 'corrections_vat',
    label: 'Invoice corrections and VAT returns',
    cell: from('corrections_vat'),
  },
  {
    key: 'einvoice_xml',
    label: 'E-invoice XML export',
    note: 'Supported file formats only; no network delivery.',
    cell: from('einvoice_xml'),
  },
  {
    key: 'ledger_exports',
    label: 'Ledger and data exports',
    note: 'Accounting reports and supported exports, including client and product CSV. Single invoice PDFs stay available in Basic.',
    cell: from('ledger_exports'),
  },
]

export type Plan = {
  id: PlanId
  name: string
  /** Per person and month, VAT included; the same figure in CHF, EUR and USD (lib/currency.ts). */
  monthly: number
  tagline: string
  pitch: string
  highlights: string[]
  /** What the plan leaves out, shown before purchase. */
  excludes: string[]
}

const PLAN_NAMES: PerPlan<string> = { basic: 'Basic', pro: 'Pro', business: 'Business' }

const storage = (plan: PlanId) => bytes(value('storage_bytes', plan))
const n = (key: LimitKey, plan: PlanId) => count(value(key, plan))

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: PLAN_NAMES.basic,
    monthly: 19,
    tagline: 'Start invoicing',
    pitch: 'For freelancers with a small client base.',
    highlights: [
      `${n('clients', 'basic')} clients per workspace`,
      `${n('invoices_per_month', 'basic')} new invoice issues per person a month`,
      'Swiss QR bills and Revolut payment links',
      `Up to ${n('engagements', 'basic')} engagements, managed by hand`,
      `${storage('basic')} storage per person`,
    ],
    excludes: [
      'Expenses and Heidi',
      'Templates, signatures, corrections and VAT returns',
      'Ledger, data exports and automations',
    ],
  },
  {
    id: 'pro',
    name: PLAN_NAMES.pro,
    monthly: 49,
    tagline: 'Run your business with Heidi',
    pitch: 'For a business that wants its whole back office in one place.',
    highlights: [
      `${n('invoices_per_month', 'pro')} invoice issues and ${n('expenses_per_month', 'pro')} expenses per person a month`,
      `${n('clients', 'pro')} clients per workspace`,
      `Heidi, with ${tokens(value('ai_tokens_per_month', 'pro'))} shared AI tokens per person a month`,
      'Templates, simple signatures, corrections and VAT returns',
      `Ledger, data exports and ${n('automation_actions_per_month', 'pro')} automation actions per person a month`,
      `${storage('pro')} storage per person`,
    ],
    excludes: ['Client portal and e-invoice XML'],
  },
  {
    id: 'business',
    name: PLAN_NAMES.business,
    monthly: 99,
    tagline: 'Work with clients at scale',
    pitch: 'Everything in Pro, plus the client portal and e-invoice XML exports.',
    highlights: [
      'Client portal; portal recipients are not paid seats',
      'E-invoice XML exports in supported formats',
      `${n('clients', 'business')} clients per workspace`,
      `${n('invoices_per_month', 'business')} invoice issues and ${n('expenses_per_month', 'business')} expenses per person a month`,
      `${tokens(value('ai_tokens_per_month', 'business'))} AI tokens and ${n('automation_actions_per_month', 'business')} automation actions per person a month`,
      `${storage('business')} storage per person`,
    ],
    excludes: [],
  },
]

/** The trial: Business features for a short time, with small allowances that neither reset nor grow with people. */
export const TRIAL = {
  days: 7,
  plan: 'business' satisfies PlanId,
  members: 2,
  invoices: 10,
  expenses: 20,
  signatures: 2,
  storageBytes: 100 * MB,
  aiTokens: 250_000,
  automationActions: 50,
}
export const TRIAL_DAYS = TRIAL.days

/** What a plan costs in an interval, as the API charges it (shared with the app, so both round alike). */
export function priceOf(plan: Plan, interval: Interval, currency = 'chf'): Price {
  const month = { amount: plan.monthly * 100, currency }
  return interval === 'month' ? month : yearOf(month)
}

export function planById(id: PlanId): Plan {
  const found = PLANS.find((p) => p.id === id)
  if (!found) throw new Error(`no plan ${id}`)
  return found
}
