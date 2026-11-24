import { localeDetails } from '@helvetly/i18n'
import { type PlanId, PLAN_IDS } from '@helvetly/ui/lib/plan-features'
import { type Price, YEARLY_DISCOUNT_PERCENT, yearOf } from '@helvetly/ui/lib/price'
// The one place the website keeps what each plan costs and includes: offer helvetly-v1's public projection (tiered
// prices, the business comparison, the plan features and the commercial allowances). Every page, card, table, FAQ and
// comparison reads it from here. Prices are checked against apps/api/internal/billing/plans.go in plans.test.ts.
// These values are the build-time copy of the offer on sale: lib/offer.ts shows prices only once the API's public
// offer confirms them, and offer.test.ts ties this module to the API through public-offer.golden.json.

import { perLanguage } from '@/lib/i18n'

export { type PlanId, PLAN_IDS, YEARLY_DISCOUNT_PERCENT }
export type Interval = 'month' | 'year'
export type PerPlan<T> = Record<PlanId, T>

/** The plans someone pays for. */
export const PAID_PLAN_IDS = PLAN_IDS.filter((id) => id !== 'free')

/** A product recommendation, not measured popularity. */
export const RECOMMENDED: PlanId = 'pro'

/** The most people a workspace can have on each plan, the owner included; null: no limit. The offer's max_self_service_seats. */
export const SELF_SERVICE_SEATS: PerPlan<number | null> = {
  free: 1,
  basic: 5,
  pro: 25,
  business: null,
}

/**
 * A fixed cap for the whole workspace, or an amount each paid team member adds to the workspace's one shared pool.
 * Monthly pools start again at 00:00 UTC on the first of the month.
 */
export type Scope = 'workspace' | 'person'
/** What an allowance counts, as the offer names it. */
export type Unit =
  | 'client'
  | 'catalog_item'
  | 'engagement'
  | 'issued_document'
  | 'issued_quote'
  | 'expense'
  | 'signature_envelope'
  | 'byte'
  | 'recipient_message'
  | 'token'
  | 'automation_action'
  | 'scheduled_event'

/** The allowance keys as the API names them. */
export type LimitKey =
  | 'clients'
  | 'products'
  | 'engagements'
  | 'invoices_per_month'
  | 'quotes_per_month'
  | 'expenses_per_month'
  | 'signatures_per_month'
  | 'storage_bytes'
  | 'emails_per_month'
  | 'ai_tokens_per_month'
  | 'ai_automation_tokens_per_month'
  | 'automation_actions_per_month'
  | 'scheduled_events_per_month'

/** The plan sets no cap; the API publishes it as included with no value. */
export const UNLIMITED = 'unlimited'
/** A cap, UNLIMITED, or null when the plan does not include it. */
export type Amount = number | typeof UNLIMITED | null

/** Bytes are decimal: 1 GB = 1'000 MB. */
export type Limit = { label: string; scope: Scope; unit: Unit; values: PerPlan<Amount> }

const MB = 1_000_000
const GB = 1_000_000_000

/** The allowances shown before purchase, in this order. */
export const USAGE_DETAILS: LimitKey[] = [
  'clients',
  'products',
  'invoices_per_month',
  'quotes_per_month',
  'expenses_per_month',
  'signatures_per_month',
  'storage_bytes',
  'emails_per_month',
  'ai_tokens_per_month',
  'automation_actions_per_month',
  'engagements',
  'scheduled_events_per_month',
]

/**
 * Every public feature of the offer and the cheapest plan with it; null: no plan has it yet. A plan has a feature
 * when it is that plan or a dearer one. offer.test.ts checks this against the golden `features`.
 */
export const OFFER_FEATURES = {
  swiss_qr: 'free',
  revolut_payment_link: 'free',
  quotes: 'free',
  invoice_documents: 'free',
  invoice_delivery: 'free',
  invoice_payments: 'free',
  clients_contacts: 'free',
  products_catalog: 'free',
  engagement_management: 'free',
  expenses: 'free',
  scheduling: 'free',
  document_library: 'free',
  recipient_document_access: 'free',
  dashboard_reports: 'free',
  heidi: 'pro',
  ai_import: 'pro',
  automations: 'pro',
  invoice_reminders: 'pro',
  invoice_instalments: 'pro',
  invoice_corrections: 'pro',
  engagement_automation: 'pro',
  document_templates: 'pro',
  simple_signatures: 'pro',
  vat_returns: 'pro',
  ledger_exports: 'pro',
  data_export: 'pro',
  remove_branding: 'pro',
  client_portal: 'business',
  custom_portal_domain: 'business',
  einvoice_xml: 'business',
  employees: 'business',
  document_approvals: 'business',
  bank_sync: null,
  einvoice_network_delivery: null,
  payroll_inventory: null,
  qualified_signatures: null,
  receivables_card_checkout: null,
} as const satisfies Record<string, PlanId | null>

export type OfferFeature = keyof typeof OFFER_FEATURES
export const OFFER_FEATURE_KEYS = Object.keys(OFFER_FEATURES).filter((key): key is OfferFeature =>
  Object.hasOwn(OFFER_FEATURES, key),
)
/** The comparison's bundles that callers name as one feature: templates and signatures, corrections and VAT. */
export type Feature = OfferFeature | 'templates_signatures' | 'corrections_vat'

const offerFeature = (feature: Feature): OfferFeature =>
  feature === 'templates_signatures'
    ? 'simple_signatures'
    : feature === 'corrections_vat'
      ? 'vat_returns'
      : feature

export function has(plan: PlanId, feature: Feature): boolean {
  const from = OFFER_FEATURES[offerFeature(feature)]
  return from !== null && PLAN_IDS.indexOf(plan) >= PLAN_IDS.indexOf(from)
}

/** Which plans have a feature, as the offer's `features` map publishes it. */
export const featurePlans = (feature: Feature): PerPlan<boolean> => ({
  free: has('free', feature),
  basic: has('basic', feature),
  pro: has('pro', feature),
  business: has('business', feature),
})

/** One row of the business comparison the API publishes: its features must all be on for a plan to have it. */
export type Benefit = {
  key: string
  label: string
  note?: string
  /** The allowances the row quotes. */
  limitKeys: LimitKey[]
  features: OfferFeature[]
}

export type Plan = {
  id: PlanId
  name: string
  /** A month for the included people, VAT included; the same figure in CHF, EUR and USD (lib/currency.ts). */
  monthly: number
  /** The people the base price covers. */
  includedPeople: number
  /** What each further person adds a month. */
  extraMonthly: number
}

/** The trial: Pro features and limits for two weeks, for a small team; card required. Afterwards a workspace without a paid plan is on Free. */
export const TRIAL = {
  days: 14,
  plan: 'pro' satisfies PlanId,
  members: 2,
}
export const TRIAL_DAYS = TRIAL.days

/** What a plan's base (its included people) costs in an interval, as the API charges it. */
export function priceOf(plan: Plan, interval: Interval, currency = 'chf'): Price {
  const month = { amount: plan.monthly * 100, currency }
  return interval === 'month' ? month : yearOf(month)
}

/** What each person beyond the included ones adds in an interval (ExtraSeatAmount in plans.go). */
export function extraPersonOf(plan: Plan, interval: Interval, currency = 'chf'): Price {
  const month = { amount: plan.extraMonthly * 100, currency }
  return interval === 'month' ? month : yearOf(month)
}

/** What a plan costs in an interval for `people` (PlanTotal in plans.go): the base plus each person beyond the included. */
export function totalOf(plan: Plan, interval: Interval, people: number, currency = 'chf'): Price {
  const extra = Math.max(people - plan.includedPeople, 0) * extraPersonOf(plan, interval).amount
  return { amount: priceOf(plan, interval).amount + extra, currency }
}

/** Everything the plans say in words, in one language. */
export const plansIn = perLanguage((translate, language) => {
  const LIMITS: Record<LimitKey, Limit> = {
    clients: {
      label: translate('clients'),
      scope: 'workspace',
      unit: 'client',
      values: { free: 5, basic: 30, pro: 300, business: UNLIMITED },
    },
    products: {
      label: translate('productsAndServices'),
      scope: 'workspace',
      unit: 'catalog_item',
      values: { free: 10, basic: 25, pro: 250, business: UNLIMITED },
    },
    engagements: {
      label: translate('activeEngagements'),
      scope: 'workspace',
      unit: 'engagement',
      values: { free: 1, basic: 3, pro: 20, business: UNLIMITED },
    },
    invoices_per_month: {
      label: translate('newInvoiceIssuesAMonth'),
      scope: 'person',
      unit: 'issued_document',
      values: { free: 3, basic: 15, pro: 100, business: UNLIMITED },
    },
    quotes_per_month: {
      label: translate('quotesSentAMonth'),
      scope: 'person',
      unit: 'issued_quote',
      values: { free: 3, basic: 5, pro: 100, business: UNLIMITED },
    },
    expenses_per_month: {
      label: translate('expensesAMonth'),
      scope: 'person',
      unit: 'expense',
      values: { free: 1, basic: 10, pro: 300, business: UNLIMITED },
    },
    signatures_per_month: {
      label: translate('signatureRequestsAMonth'),
      scope: 'person',
      unit: 'signature_envelope',
      values: { free: null, basic: null, pro: 50, business: UNLIMITED },
    },
    storage_bytes: {
      label: translate('documentStorage'),
      scope: 'person',
      unit: 'byte',
      values: { free: 100 * MB, basic: 500 * MB, pro: 5 * GB, business: 20 * GB },
    },
    emails_per_month: {
      label: translate('businessEmailRecipientsAMonth'),
      scope: 'person',
      unit: 'recipient_message',
      values: { free: 20, basic: 100, pro: 500, business: 2000 },
    },
    ai_tokens_per_month: {
      label: translate('aiTokensAMonthForAvailableFunctions'),
      scope: 'person',
      unit: 'token',
      values: { free: null, basic: null, pro: 5_000_000, business: 20_000_000 },
    },
    ai_automation_tokens_per_month: {
      label: translate('aiImportTokensAMonth'),
      scope: 'person',
      unit: 'token',
      values: { free: null, basic: null, pro: 5_000_000, business: 20_000_000 },
    },
    automation_actions_per_month: {
      label: translate('automatedActionsAMonth'),
      scope: 'person',
      unit: 'automation_action',
      values: { free: null, basic: null, pro: 1500, business: 6000 },
    },
    scheduled_events_per_month: {
      label: translate('scheduledSessionsAMonth'),
      scope: 'workspace',
      unit: 'scheduled_event',
      values: { free: 3, basic: 10, pro: 100, business: UNLIMITED },
    },
  }

  const PLAN_NAMES: PerPlan<string> = {
    free: translate('free'),
    basic: translate('basic'),
    pro: translate('pro'),
    business: translate('business'),
  }

  /** "Pro or Business", "Business": the plans a feature needs. */
  function plansWith(
    feature: Feature,
    type: 'conjunction' | 'disjunction' = 'disjunction',
  ): string {
    return new Intl.ListFormat(localeDetails(language).languageTag, { type }).format(
      PLAN_IDS.filter((id) => has(id, feature)).map((id) => PLAN_NAMES[id]),
    )
  }

  /** Swiss thousands: 1’500. */
  const count = (n: number) =>
    n.toLocaleString(localeDetails(language).numberLocale).replaceAll("'", '’')
  /** Decimal megabytes and gigabytes: 500 MB, 5 GB. */
  const bytes = (n: number) => (n >= GB ? `${count(n / GB)} GB` : `${count(n / MB)} MB`)
  /** Tokens in short: 250’000, 5M. */
  const tokens = (n: number) => (n >= 1_000_000 ? `${count(n / 1_000_000)}M` : count(n))

  const isUnlimited = (key: LimitKey, plan: PlanId) => LIMITS[key].values[plan] === UNLIMITED

  /** A capped allowance's number; one that is not included or not capped has none to quote. */
  function value(key: LimitKey, plan: PlanId): number {
    const v = LIMITS[key].values[plan]
    if (v === null || v === UNLIMITED) throw new Error(translate('hasNo', { plan: plan, key: key }))
    return v
  }

  /** The sixteen business benefits the API compares, in this order (public_pricing.comparison_rows). */
  const BENEFITS: Benefit[] = [
    {
      key: 'invoicing',
      label: translate('invoicesAndQuotes'),
      limitKeys: ['invoices_per_month', 'quotes_per_month'],
      features: ['invoice_documents', 'quotes'],
    },
    {
      key: 'swiss_qr',
      label: translate('swissQRBills'),
      limitKeys: [],
      features: ['swiss_qr'],
    },
    {
      key: 'revolut',
      label: translate('revolutPaymentLink'),
      note: translate('revolutMeLinkAndQRThePayerEntersTheDisplayed'),
      limitKeys: [],
      features: ['revolut_payment_link'],
    },
    {
      key: 'engagements',
      label: translate('engagementsAndRetainers'),
      note: translate('manualEngagementManagementInEveryPlanScheduledWorkflows'),
      limitKeys: ['engagements'],
      features: ['engagement_management'],
    },
    {
      key: 'scheduling',
      label: translate('schedulingBookingLinksAndCalendarSync'),
      limitKeys: ['scheduled_events_per_month'],
      features: ['scheduling'],
    },
    {
      key: 'automations',
      label: translate('automationsAndPaymentReminders'),
      limitKeys: ['automation_actions_per_month'],
      features: ['automations'],
    },
    {
      key: 'heidi',
      label: translate('heidiAIAssistant'),
      limitKeys: ['ai_tokens_per_month'],
      features: ['heidi'],
    },
    {
      key: 'client_portal',
      label: translate('clientPortal'),
      limitKeys: [],
      features: ['client_portal'],
    },
    {
      key: 'expenses',
      label: translate('expensesAndReceipts'),
      limitKeys: ['expenses_per_month'],
      features: ['expenses'],
    },
    {
      key: 'ai_import',
      label: translate('aiImportOfReceiptsInvoicesAndDocuments'),
      limitKeys: ['ai_automation_tokens_per_month'],
      features: ['ai_import'],
    },
    {
      key: 'documents_signatures',
      label: translate('documentTemplatesAndSimpleSignatures'),
      limitKeys: ['signatures_per_month'],
      features: ['document_templates', 'simple_signatures'],
    },
    {
      key: 'corrections_vat',
      label: translate('invoiceCorrectionsAndVATReturns'),
      limitKeys: [],
      features: ['invoice_corrections', 'vat_returns'],
    },
    {
      key: 'einvoice_xml',
      label: translate('eInvoiceXMLExport'),
      note: translate('supportedFileFormatsOnlyNoNetworkDelivery'),
      limitKeys: [],
      features: ['einvoice_xml'],
    },
    {
      key: 'ledger_exports',
      label: translate('ledgerAndDataExports'),
      note: translate('accountingReportsAndSupportedExportsIncludingClientAndProduct'),
      limitKeys: [],
      features: ['ledger_exports', 'data_export'],
    },
    {
      key: 'employees',
      label: translate('employeesAndPayrollRegister'),
      note: translate('staffRecordsEmployeeDocumentsAndAPayrollRegister'),
      limitKeys: [],
      features: ['employees'],
    },
    {
      key: 'remove_branding',
      label: translate('noSentWithHelvetlyOnEmailAndPDFs'),
      limitKeys: [],
      features: ['remove_branding'],
    },
  ]

  const PLANS: Plan[] = [
    { id: 'free', name: PLAN_NAMES.free, monthly: 0, includedPeople: 1, extraMonthly: 0 },
    { id: 'basic', name: PLAN_NAMES.basic, monthly: 19, includedPeople: 1, extraMonthly: 10 },
    { id: 'pro', name: PLAN_NAMES.pro, monthly: 49, includedPeople: 2, extraMonthly: 15 },
    {
      id: 'business',
      name: PLAN_NAMES.business,
      monthly: 149,
      includedPeople: 5,
      extraMonthly: 20,
    },
  ]

  function planById(id: PlanId): Plan {
    const found = PLANS.find((p) => p.id === id)
    if (!found) throw new Error(translate('noPlan', { id: id }))
    return found
  }
  return {
    LIMITS,
    isUnlimited,
    value,
    plansWith,
    count,
    bytes,
    tokens,
    BENEFITS,
    PLANS,
    planById,
  }
})
