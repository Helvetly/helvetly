import { type Locale, localeDetails } from '@helvetly/i18n'

import { translatorFor } from './i18n'
// The one list of what each plan includes, for the website's pricing cards and comparison table and the app's plan
// picker alike. Every number and every plan's access comes from the offer the API publishes
// (GET /api/v1/public/offers/current: `features`, `limits`, `max_self_service_seats`); the wording and the grouping
// live here.

export type PlanId = 'free' | 'basic' | 'pro' | 'business'
export const PLAN_IDS: PlanId[] = ['free', 'basic', 'pro', 'business']
type PerPlan<T> = Record<PlanId, T>

/** The parts of the public offer the cards and the table read. */
export type PlanCatalogue = {
  plans: { id: PlanId; name: string }[]
  /** Every public feature key, and which plans include it. */
  features: Partial<Record<string, PerPlan<boolean>>>
  /** The most people a workspace can have, the owner included; null: no cap. */
  max_self_service_seats: PerPlan<number | null>
  /** value: for one person, null when unlimited; not included is `included: false` or 0. */
  limits: Partial<
    Record<
      string,
      { period: string | null; plans: PerPlan<{ included: boolean; value: number | null }> }
    >
  >
}

type Translate = ReturnType<typeof translatorFor>
type MessageKey = Parameters<Translate>[0]

export const PLAN_GROUPS = [
  'get_paid',
  'run_your_day',
  'work_with_clients',
  'automate_ai',
  'team_compliance',
] as const
export type PlanGroup = (typeof PLAN_GROUPS)[number]

const GROUP_TITLES: Record<PlanGroup, MessageKey> = {
  get_paid: 'planGroupGetPaid',
  run_your_day: 'planGroupRunYourDay',
  work_with_clients: 'planGroupClients',
  automate_ai: 'planGroupAI',
  team_compliance: 'planGroupTeam',
}

/** An allowance of the offer (its limit key) or the people a plan takes. */
export type PlanLimit = string

/**
 * Who has a row: the offer's public features that must all be on, or `internal`, a gated feature the public offer
 * does not publish (its plans come from the offer document; the website's tests check them). Neither: every plan.
 */
type RowDef = {
  key: string
  group: PlanGroup
  /** The comparison table's wording. */
  label: MessageKey
  /** The (?) beside it: what it does, in a sentence or two. */
  hint?: MessageKey
  features?: string[]
  internal?: { feature: string; from: PlanId }
  /** The table's cell quotes this allowance instead of a tick. */
  limit?: PlanLimit
}

// In this order in each group, on the cards and in the table.
const ROWS: RowDef[] = [
  // Get paid
  {
    key: 'invoices',
    group: 'get_paid',
    label: 'planRowInvoices',
    hint: 'planHintInvoices',
    features: ['invoice_documents'],
    limit: 'invoices_per_month',
  },
  {
    key: 'quotes',
    group: 'get_paid',
    label: 'planRowQuotes',
    hint: 'planHintQuotes',
    features: ['quotes'],
    limit: 'quotes_per_month',
  },
  {
    key: 'swiss_qr',
    group: 'get_paid',
    label: 'planRowSwissQR',
    hint: 'planHintSwissQR',
    features: ['swiss_qr'],
  },
  {
    key: 'revolut',
    group: 'get_paid',
    label: 'planRowRevolut',
    hint: 'planHintRevolut',
    features: ['revolut_payment_link'],
  },
  {
    key: 'payments',
    group: 'get_paid',
    label: 'planRowPayments',
    hint: 'planHintPayments',
    features: ['invoice_payments'],
  },
  {
    key: 'currencies',
    group: 'get_paid',
    label: 'planRowCurrencies',
    hint: 'planHintCurrencies',
  },
  {
    key: 'vat',
    group: 'get_paid',
    label: 'planRowVAT',
    hint: 'planHintVAT',
  },
  {
    key: 'reminders',
    group: 'get_paid',
    label: 'planRowReminders',
    hint: 'planHintReminders',
    features: ['invoice_reminders'],
  },
  {
    key: 'instalments',
    group: 'get_paid',
    label: 'planRowInstalments',
    hint: 'planHintInstalments',
    features: ['invoice_instalments'],
  },
  {
    key: 'corrections',
    group: 'get_paid',
    label: 'planRowCorrections',
    hint: 'planHintCorrections',
    features: ['invoice_corrections'],
  },
  {
    key: 'einvoice',
    group: 'get_paid',
    label: 'planRowEInvoice',
    hint: 'planHintEInvoice',
    features: ['einvoice_xml'],
  },

  // Run your day
  {
    key: 'scheduling',
    group: 'run_your_day',
    label: 'planRowScheduling',
    hint: 'planHintScheduling',
    features: ['scheduling'],
    limit: 'scheduled_events_per_month',
  },
  {
    key: 'booking_links',
    group: 'run_your_day',
    label: 'planRowBookingLinks',
    hint: 'planHintBookingLinks',
    features: ['scheduling'],
  },
  {
    key: 'calendar_sync',
    group: 'run_your_day',
    label: 'planRowCalendarSync',
    hint: 'planHintCalendarSync',
    features: ['scheduling', 'calendar_sync'],
  },
  {
    key: 'expenses',
    group: 'run_your_day',
    label: 'planRowExpenses',
    hint: 'planHintExpenses',
    features: ['expenses'],
    limit: 'expenses_per_month',
  },
  {
    key: 'documents',
    group: 'run_your_day',
    label: 'planRowDocuments',
    hint: 'planHintDocuments',
    features: ['document_library'],
    limit: 'storage_bytes',
  },
  {
    key: 'products',
    group: 'run_your_day',
    label: 'planRowProducts',
    features: ['products_catalog'],
    limit: 'products',
  },
  {
    key: 'dashboard',
    group: 'run_your_day',
    label: 'planRowDashboard',
    hint: 'planHintDashboard',
    features: ['dashboard_reports'],
  },

  // Work with clients
  {
    key: 'clients',
    group: 'work_with_clients',
    label: 'planRowClients',
    hint: 'planHintClients',
    features: ['clients_contacts'],
    limit: 'clients',
  },
  {
    key: 'uid',
    group: 'work_with_clients',
    label: 'planRowUID',
    hint: 'planHintUID',
  },
  {
    key: 'engagements',
    group: 'work_with_clients',
    label: 'planRowEngagements',
    hint: 'planHintEngagements',
    features: ['engagement_management'],
    limit: 'engagements',
  },
  {
    key: 'emails',
    group: 'work_with_clients',
    label: 'planRowEmails',
    hint: 'planHintEmails',
    features: ['invoice_delivery', 'recipient_document_access'],
    limit: 'emails_per_month',
  },
  {
    key: 'signatures',
    group: 'work_with_clients',
    label: 'planRowSignatures',
    hint: 'planHintSignatures',
    features: ['simple_signatures'],
    limit: 'signatures_per_month',
  },
  {
    key: 'contracts',
    group: 'work_with_clients',
    label: 'planRowContracts',
    hint: 'planHintContracts',
    features: ['document_templates'],
  },
  {
    key: 'portal',
    group: 'work_with_clients',
    label: 'planRowPortal',
    hint: 'planHintPortal',
    features: ['client_portal', 'custom_portal_domain'],
  },

  // Automate with AI
  {
    key: 'heidi',
    group: 'automate_ai',
    label: 'planRowHeidi',
    hint: 'planHintHeidi',
    features: ['heidi'],
    limit: 'ai_tokens_per_month',
  },
  {
    key: 'ai_import',
    group: 'automate_ai',
    label: 'planRowAIImport',
    hint: 'planHintAIImport',
    features: ['ai_import'],
    limit: 'ai_automation_tokens_per_month',
  },
  {
    key: 'ai_filing',
    group: 'automate_ai',
    label: 'planRowAIFiling',
    hint: 'planHintAIFiling',
    features: ['ai_import'],
  },
  {
    key: 'automations',
    group: 'automate_ai',
    label: 'planRowAutomations',
    hint: 'planHintAutomations',
    features: ['automations', 'engagement_automation'],
    limit: 'automation_actions_per_month',
  },
  {
    key: 'api',
    group: 'automate_ai',
    label: 'planRowAPI',
    hint: 'planHintAPI',
    internal: { feature: 'api_access', from: 'pro' },
  },

  // Team & compliance
  {
    key: 'people',
    group: 'team_compliance',
    label: 'planRowPeople',
    hint: 'planHintPeople',
    limit: 'people',
  },
  {
    key: 'roles',
    group: 'team_compliance',
    label: 'planRowRoles',
    hint: 'planHintRoles',
    internal: { feature: 'workspace_roles', from: 'free' },
  },
  {
    key: 'sign_in',
    group: 'team_compliance',
    label: 'planRowSignIn',
    hint: 'planHintSignIn',
    internal: { feature: 'identity_security', from: 'free' },
  },
  {
    key: 'audit',
    group: 'team_compliance',
    label: 'planRowAudit',
    hint: 'planHintAudit',
    internal: { feature: 'period_closing_audit', from: 'free' },
  },
  {
    key: 'vat_returns',
    group: 'team_compliance',
    label: 'planRowVATReturns',
    hint: 'planHintVATReturns',
    features: ['vat_returns'],
  },
  {
    key: 'ledger',
    group: 'team_compliance',
    label: 'planRowLedger',
    hint: 'planHintLedger',
    features: ['ledger_exports'],
  },
  {
    key: 'data_export',
    group: 'team_compliance',
    label: 'planRowDataExport',
    hint: 'planHintDataExport',
    features: ['data_export'],
  },
  {
    key: 'approvals',
    group: 'team_compliance',
    label: 'planRowApprovals',
    hint: 'planHintApprovals',
    features: ['document_approvals'],
  },
  {
    key: 'employees',
    group: 'team_compliance',
    label: 'planRowEmployees',
    hint: 'planHintEmployees',
    features: ['employees'],
  },
  {
    key: 'branding',
    group: 'team_compliance',
    label: 'planRowBranding',
    hint: 'planHintBranding',
    features: ['remove_branding'],
  },
  {
    key: 'languages',
    group: 'team_compliance',
    label: 'planRowLanguages',
    hint: 'planHintLanguages',
  },
  {
    key: 'support',
    group: 'team_compliance',
    label: 'planRowSupport',
    hint: 'planHintSupport',
  },
]

/**
 * The public features no plan offers yet: the table leaves them out. With the rows above they are every key of the
 * offer's `features` (a test holds them in step).
 */
export const UNOFFERED_FEATURES = [
  'bank_sync',
  'einvoice_network_delivery',
  'payroll_inventory',
  'qualified_signatures',
  'receivables_card_checkout',
]

/** The public feature keys the rows read: with UNOFFERED_FEATURES, every key the offer publishes. */
export const ROW_FEATURES = [...new Set(ROWS.flatMap((row) => row.features ?? []))]

/** The gated features the public offer leaves out, and the cheapest plan with each (checked against the offer). */
export const INTERNAL_ROWS = ROWS.flatMap((row) => (row.internal ? [row.internal] : []))

/**
 * A card's feature line: a row it is gated by (shown only when the plan has it) with the card's short wording,
 * `people`: how many people the plan takes, or `everything`: "Everything in <the plan before>".
 */
type CardFeature = { row: string; label: MessageKey } | 'people' | 'everything'

/** Each card's tagline and its five lead features at most, the most attractive ones; the rest is the table's. */
const PLAN_COPY: PerPlan<{ tagline: MessageKey; features: CardFeature[] }> = {
  free: {
    tagline: 'planHeadlineFree',
    features: [
      { row: 'swiss_qr', label: 'planCardInvoices' },
      { row: 'scheduling', label: 'planCardScheduling' },
      { row: 'expenses', label: 'planCardExpenses' },
    ],
  },
  basic: {
    tagline: 'planHeadlineBasic',
    features: [
      { row: 'swiss_qr', label: 'planCardInvoices' },
      { row: 'booking_links', label: 'planCardScheduling' },
      { row: 'expenses', label: 'planCardExpenses' },
      { row: 'audit', label: 'planCardDashboard' },
      'people',
    ],
  },
  pro: {
    tagline: 'planHeadlinePro',
    features: [
      'everything',
      { row: 'heidi', label: 'planCardHeidi' },
      { row: 'ai_import', label: 'planCardAIImport' },
      { row: 'contracts', label: 'planCardSignatures' },
      { row: 'reminders', label: 'planCardReminders' },
    ],
  },
  business: {
    tagline: 'planHeadlineBusiness',
    features: [
      'everything',
      { row: 'portal', label: 'planCardPortal' },
      { row: 'einvoice', label: 'planCardEInvoice' },
      { row: 'approvals', label: 'planCardApprovals' },
      { row: 'employees', label: 'planCardEmployees' },
    ],
  },
}

const MB = 1_000_000
const GB = 1_000_000_000

/**
 * One allowance of a plan as the cards and the table show it: "300", "5 GB", "5M", or "Unlimited" when the plan sets
 * no cap; undefined when the plan does not include it. `limit` is an offer allowance key or `people`.
 */
export function planAllowance(
  offer: Pick<PlanCatalogue, 'limits' | 'max_self_service_seats'>,
  limit: PlanLimit,
  plan: PlanId,
  language: Locale,
): { amount: string; value: number | null } | undefined {
  const allowance = offer.limits[limit]?.plans[plan]
  const value =
    limit === 'people'
      ? offer.max_self_service_seats[plan]
      : allowance?.included
        ? (allowance.value ?? null)
        : 0
  if (value === 0) return undefined
  if (value === null) return { amount: translatorFor(language)('planUnlimited'), value }
  const count = (n: number) =>
    n.toLocaleString(localeDetails(language).numberLocale).replaceAll("'", '’')
  if (limit === 'storage_bytes')
    return { amount: value >= GB ? `${count(value / GB)} GB` : `${count(value / MB)} MB`, value }
  if (limit.includes('tokens') && value >= 1_000_000)
    return { amount: `${count(value / 1_000_000)}M`, value }
  return { amount: count(value), value }
}

function hasRow(offer: PlanCatalogue, row: RowDef, plan: PlanId): boolean {
  if (row.internal) return PLAN_IDS.indexOf(plan) >= PLAN_IDS.indexOf(row.internal.from)
  return (row.features ?? []).every((key) => offer.features[key]?.[plan] === true)
}

export type PlanLine = { key: string; label: string }
export type PlanCardData = {
  plan: PlanId
  name: string
  tagline: string
  /** At most five short lines; the comparison table has the rest. */
  features: PlanLine[]
  /** Three key allowances, e.g. "15 invoices / mo", "30 clients", "500 MB". */
  stats: string[]
}

/** Each plan's compact card: tagline, its lead features (those the plan has) and three key allowances. */
export function planCards(offer: PlanCatalogue, language: Locale): PlanCardData[] {
  const translate = translatorFor(language)
  return offer.plans.map(({ id, name }, index) => {
    const below = offer.plans[index - 1]
    const features = PLAN_COPY[id].features.flatMap((feature): PlanLine[] => {
      if (feature === 'everything')
        return below
          ? [{ key: feature, label: translate('planEverythingIn', { plan: below.name }) }]
          : []
      if (feature === 'people') {
        const seats = offer.max_self_service_seats[id]
        return seats === null
          ? []
          : [{ key: feature, label: translate('planCardPeopleUpTo', { count: seats }) }]
      }
      const row = ROWS.find((r) => r.key === feature.row)
      return row && hasRow(offer, row, id)
        ? [{ key: row.key, label: translate(feature.label) }]
        : []
    })
    const stat = (limit: PlanLimit) => planAllowance(offer, limit, id, language)
    const invoices = stat('invoices_per_month')
    const clients = stat('clients')
    const storage = stat('storage_bytes')
    const stats = [
      invoices &&
        (invoices.value === null
          ? translate('planStatInvoicesUnlimited')
          : translate('planStatInvoices', { count: invoices.value })),
      clients &&
        (clients.value === null
          ? translate('planStatClientsUnlimited')
          : translate('planStatClients', { count: clients.value })),
      storage?.amount,
    ].filter((line): line is string => Boolean(line))
    return { plan: id, name, tagline: translate(PLAN_COPY[id].tagline), features, stats }
  })
}

/** A table cell: included, not included, or an allowance with its unit ("/ month"). */
export type ComparisonCell =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'amount'; amount: string; unit?: string }
export type ComparisonRow = {
  key: string
  label: string
  hint?: string
  cells: PerPlan<ComparisonCell>
}
export type ComparisonGroup = { group: PlanGroup; title: string; rows: ComparisonRow[] }

/** Every row, grouped as the cards are: ✓ or – per plan, or the allowance where the row has one. */
export function planComparison(offer: PlanCatalogue, language: Locale): ComparisonGroup[] {
  const translate = translatorFor(language)
  const cell = (row: RowDef, plan: PlanId): ComparisonCell => {
    if (!hasRow(offer, row, plan)) return { kind: 'no' }
    if (!row.limit) return { kind: 'yes' }
    const allowance = planAllowance(offer, row.limit, plan, language)
    if (!allowance) return { kind: 'no' }
    const monthly = offer.limits[row.limit]?.period === 'calendar_month_utc'
    return allowance.value !== null && monthly
      ? { kind: 'amount', amount: allowance.amount, unit: translate('planPerMonth') }
      : { kind: 'amount', amount: allowance.amount }
  }
  return PLAN_GROUPS.map((group) => ({
    group,
    title: translate(GROUP_TITLES[group]),
    rows: ROWS.filter((row) => row.group === group).map((row) => ({
      key: row.key,
      label: translate(row.label),
      hint: row.hint && translate(row.hint),
      cells: {
        free: cell(row, 'free'),
        basic: cell(row, 'basic'),
        pro: cell(row, 'pro'),
        business: cell(row, 'business'),
      },
    })),
  }))
}

/**
 * Free's few facts for its compact row under the paid plans: "3 invoices & 3 quotes / month", "Swiss QR bills",
 * "5 clients". The full list, its limits included, is the comparison's Free column.
 */
export function freePlanFacts(offer: PlanCatalogue, language: Locale): string[] {
  const translate = translatorFor(language)
  const value = (limit: PlanLimit) => planAllowance(offer, limit, 'free', language)?.value ?? 0
  return [
    translate('planFreeFactInvoicesQuotes', {
      invoices: value('invoices_per_month'),
      quotes: value('quotes_per_month'),
    }),
    translate('planFreeFactSwissQR'),
    translate('planFreeFactClients', { count: value('clients') }),
  ]
}

/** The note under the plans: what the per-person amounts mean, and that clients use the portal for free. */
export const planFootnote = (language: Locale) => translatorFor(language)('planFootnote')
