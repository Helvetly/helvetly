import { languageTag, numberLocale } from '@helvetly/i18n'
import { type Price, YEARLY_DISCOUNT_PERCENT, yearOf } from '@helvetly/ui/lib/price'
// The one place the website keeps what each plan costs and includes: offer v2's public projection (prices,
// the business comparison and the commercial allowances). Every page, card, table, FAQ and comparison reads it
// from here. Prices are checked against apps/api/internal/billing/plans.go in plans.test.ts.
// These values are the build-time copy of the offer on sale: lib/offer.ts shows prices only once the API's public
// offer confirms them, and offer.test.ts ties this module to the API through public-offer.golden.json.

import { translate } from '@/lib/i18n'

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
/** What an allowance counts, as the offer names it. */
export type Unit =
  | 'client'
  | 'catalog_item'
  | 'engagement'
  | 'issued_document'
  | 'expense'
  | 'signature_envelope'
  | 'byte'
  | 'recipient_message'
  | 'token'
  | 'automation_action'

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
    label: translate('clients'),
    scope: 'workspace',
    unit: 'client',
    values: { basic: 30, pro: 300, business: 1500 },
  },
  products: {
    label: translate('productsAndServices'),
    scope: 'workspace',
    unit: 'catalog_item',
    values: { basic: 25, pro: 250, business: 1000 },
  },
  engagements: {
    label: translate('activeEngagements'),
    scope: 'workspace',
    unit: 'engagement',
    values: { basic: 3, pro: 20, business: 100 },
  },
  invoices_per_month: {
    label: translate('newInvoiceIssuesAMonth'),
    scope: 'person',
    unit: 'issued_document',
    values: { basic: 15, pro: 150, business: 600 },
  },
  expenses_per_month: {
    label: translate('expensesAMonth'),
    scope: 'person',
    unit: 'expense',
    values: { basic: null, pro: 300, business: 1200 },
  },
  signatures_per_month: {
    label: translate('signatureRequestsAMonth'),
    scope: 'person',
    unit: 'signature_envelope',
    values: { basic: null, pro: 50, business: 200 },
  },
  storage_bytes: {
    label: translate('documentStorage'),
    scope: 'person',
    unit: 'byte',
    values: { basic: 500 * MB, pro: 5 * GB, business: 20 * GB },
  },
  download_bytes_per_month: {
    label: translate('fileDownloadsAMonth'),
    scope: 'person',
    unit: 'byte',
    values: { basic: 2 * GB, pro: 20 * GB, business: 100 * GB },
  },
  emails_per_month: {
    label: translate('businessEmailRecipientsAMonth'),
    scope: 'person',
    unit: 'recipient_message',
    values: { basic: 100, pro: 1000, business: 5000 },
  },
  email_attachment_bytes_per_month: {
    label: translate('totalEmailAttachmentsAMonth'),
    scope: 'person',
    unit: 'byte',
    values: { basic: 100 * MB, pro: 1 * GB, business: 5 * GB },
  },
  ai_tokens_per_month: {
    label: translate('aiTokensAMonthForAvailableFunctions'),
    scope: 'person',
    unit: 'token',
    values: { basic: 250_000, pro: 5_000_000, business: 20_000_000 },
  },
  automation_actions_per_month: {
    label: translate('automationActionsAMonth'),
    scope: 'person',
    unit: 'automation_action',
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
  employees: 'business',
} as const satisfies Record<string, PlanId>

export type Feature = keyof typeof FEATURE_FROM

export function has(plan: PlanId, feature: Feature): boolean {
  return PLAN_IDS.indexOf(plan) >= PLAN_IDS.indexOf(FEATURE_FROM[feature])
}

/** "Pro or Business", "Business": the plans a feature needs. */
export function plansWith(
  feature: Feature,
  type: 'conjunction' | 'disjunction' = 'disjunction',
): string {
  return new Intl.ListFormat(languageTag, { type }).format(
    PLAN_IDS.filter((id) => has(id, feature)).map((id) => PLAN_NAMES[id]),
  )
}

/** Swiss thousands: 1’500. */
export const count = (n: number) => n.toLocaleString(numberLocale).replaceAll("'", '’')
/** Decimal megabytes and gigabytes: 500 MB, 5 GB. */
export const bytes = (n: number) => (n >= GB ? `${count(n / GB)} GB` : `${count(n / MB)} MB`)
/** Tokens in short: 250’000, 5M. */
export const tokens = (n: number) => (n >= 1_000_000 ? `${count(n / 1_000_000)}M` : count(n))

/** One allowance as the usage table shows it; null when the plan does not include it. */
export function formatLimit(key: LimitKey, plan: PlanId): string | null {
  const { unit, values } = LIMITS[key]
  const amount = values[plan]
  if (amount === null) return null
  return unit === 'byte' ? bytes(amount) : count(amount)
}

function value(key: LimitKey, plan: PlanId): number {
  const v = LIMITS[key].values[plan]
  if (v === null) throw new Error(translate('hasNo', { plan: plan, key: key }))
  return v
}

const perPerson = (key: LimitKey, what: string) => (plan: PlanId) =>
  LIMITS[key].values[plan] === null
    ? null
    : translate('offerPerPersonAllowance', { count: count(value(key, plan)), allowance: what })

/** A comparison cell: what the plan gives, or null for not included. */
export type Benefit = {
  key: string
  label: string
  note?: string
  /** The allowances the row's cells quote. */
  limitKeys: LimitKey[]
  cell: (plan: PlanId) => string | null
}

const INCLUDED = translate('included')
const from = (feature: Feature) => (plan: PlanId) => (has(plan, feature) ? INCLUDED : null)

/** The thirteen business benefits compared on the pricing page, in this order. */
export const BENEFITS: Benefit[] = [
  {
    key: 'invoicing',
    label: translate('invoicesAndQuotes'),
    limitKeys: ['invoices_per_month'],
    cell: perPerson('invoices_per_month', translate('newInvoiceIssues')),
  },
  { key: 'swiss_qr', label: translate('swissQRBills'), limitKeys: [], cell: () => INCLUDED },
  {
    key: 'revolut',
    label: translate('revolutPaymentLink'),
    note: translate('revolutMeLinkAndQRThePayerEntersTheDisplayed'),
    limitKeys: [],
    cell: () => INCLUDED,
  },
  {
    key: 'engagements',
    label: translate('engagementsAndRetainers'),
    note: translate('manualEngagementManagementInEveryPlanScheduledWorkflows'),
    limitKeys: ['engagements'],
    cell: (plan) =>
      translate('activePerWorkspace', {
        value1: count(value('engagements', plan)),
        value2: has(plan, 'automations') ? '' : translate('manualWorkflows'),
      }),
  },
  {
    key: 'automations',
    label: translate('automationsAndPaymentReminders'),
    limitKeys: ['automation_actions_per_month'],
    cell: perPerson('automation_actions_per_month', 'actions'),
  },
  {
    key: 'heidi',
    label: translate('heidiAIAssistant'),
    limitKeys: ['ai_tokens_per_month'],
    cell: (plan) =>
      has(plan, 'heidi')
        ? translate('includedSharedAITokensPersonMonth', {
            value1: tokens(value('ai_tokens_per_month', plan)),
          })
        : null,
  },
  {
    key: 'client_portal',
    label: translate('clientPortal'),
    limitKeys: [],
    cell: from('client_portal'),
  },
  {
    key: 'expenses',
    label: translate('expensesAndAIReceiptImport'),
    limitKeys: ['expenses_per_month'],
    cell: perPerson('expenses_per_month', 'expenses'),
  },
  {
    key: 'documents_signatures',
    label: translate('documentTemplatesAndSimpleSignatures'),
    limitKeys: ['signatures_per_month'],
    cell: perPerson('signatures_per_month', translate('signatureRequests')),
  },
  {
    key: 'corrections_vat',
    label: translate('invoiceCorrectionsAndVATReturns'),
    limitKeys: [],
    cell: from('corrections_vat'),
  },
  {
    key: 'einvoice_xml',
    label: translate('eInvoiceXMLExport'),
    note: translate('supportedFileFormatsOnlyNoNetworkDelivery'),
    limitKeys: [],
    cell: from('einvoice_xml'),
  },
  {
    key: 'ledger_exports',
    label: translate('ledgerAndDataExports'),
    note: translate('accountingReportsAndSupportedExportsIncludingClientAndProduct'),
    limitKeys: [],
    cell: from('ledger_exports'),
  },
  {
    key: 'employees',
    label: translate('employeesAndPayrollRegister'),
    note: translate('staffRecordsEmployeeDocumentsAndAPayrollRegister'),
    limitKeys: [],
    cell: from('employees'),
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

const PLAN_NAMES: PerPlan<string> = {
  basic: translate('basic'),
  pro: translate('pro'),
  business: translate('business'),
}

const storage = (plan: PlanId) => bytes(value('storage_bytes', plan))
const n = (key: LimitKey, plan: PlanId) => count(value(key, plan))

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: PLAN_NAMES.basic,
    monthly: 19,
    tagline: translate('startInvoicing'),
    pitch: translate('forFreelancersWithASmallClientBase'),
    highlights: [
      translate('clientsPerWorkspace', { value1: n('clients', 'basic') }),
      translate('newInvoiceIssuesPerPersonAMonth', { value1: n('invoices_per_month', 'basic') }),
      translate('swissQRBillsAndRevolutPaymentLinks'),
      translate('upToEngagementsManagedByHand', { value1: n('engagements', 'basic') }),
      translate('storagePerPerson', { value1: storage('basic') }),
    ],
    excludes: [
      translate('expensesAndHeidi'),
      translate('templatesSignaturesCorrectionsAndVATReturns'),
      translate('ledgerDataExportsAndAutomations'),
    ],
  },
  {
    id: 'pro',
    name: PLAN_NAMES.pro,
    monthly: 49,
    tagline: translate('runYourBusinessWithHeidi'),
    pitch: translate('forABusinessThatWantsItsWholeBackOffice'),
    highlights: [
      translate('invoiceIssuesAndExpensesPerPersonAMonth', {
        value1: n('invoices_per_month', 'pro'),
        value2: n('expenses_per_month', 'pro'),
      }),
      translate('clientsPerWorkspace', { value1: n('clients', 'pro') }),
      translate('heidiWithSharedAITokensPerPersonAMonth', {
        value1: tokens(value('ai_tokens_per_month', 'pro')),
      }),
      translate('templatesSimpleSignaturesCorrectionsAndVATReturns'),
      translate('ledgerDataExportsAndAutomationActionsPerPersonA', {
        value1: n('automation_actions_per_month', 'pro'),
      }),
      translate('storagePerPerson', { value1: storage('pro') }),
    ],
    excludes: [translate('clientPortalAndEInvoiceXML'), translate('employeesAndPayrollRegister')],
  },
  {
    id: 'business',
    name: PLAN_NAMES.business,
    monthly: 99,
    tagline: translate('workWithClientsAtScale'),
    pitch: translate('everythingInProPlusTheClientPortalAndE'),
    highlights: [
      translate('clientPortalPortalRecipientsAreNotPaidSeats'),
      translate('eInvoiceXMLExportsInSupportedFormats'),
      translate('employeesAndPayrollRegister'),
      translate('clientsPerWorkspace', { value1: n('clients', 'business') }),
      translate('invoiceIssuesAndExpensesPerPersonAMonth', {
        value1: n('invoices_per_month', 'business'),
        value2: n('expenses_per_month', 'business'),
      }),
      translate('aiTokensAndAutomationActionsPerPersonAMonth', {
        value1: tokens(value('ai_tokens_per_month', 'business')),
        value2: n('automation_actions_per_month', 'business'),
      }),
      translate('storagePerPerson', { value1: storage('business') }),
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
  if (!found) throw new Error(translate('noPlan', { id: id }))
  return found
}
