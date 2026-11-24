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
  /** The card's wording, when the row is on the cards. Cards name features, never numbers. */
  card?: MessageKey
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
    card: 'planCardInvoices',
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
    card: 'planCardPayments',
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
    card: 'planCardReminders',
    features: ['invoice_reminders'],
  },
  {
    key: 'instalments',
    group: 'get_paid',
    label: 'planRowInstalments',
    hint: 'planHintInstalments',
    card: 'planCardInstalments',
    features: ['invoice_instalments'],
  },
  {
    key: 'corrections',
    group: 'get_paid',
    label: 'planRowCorrections',
    hint: 'planHintCorrections',
    card: 'planCardCorrections',
    features: ['invoice_corrections'],
  },
  {
    key: 'einvoice',
    group: 'get_paid',
    label: 'planRowEInvoice',
    hint: 'planHintEInvoice',
    card: 'planCardEInvoice',
    features: ['einvoice_xml'],
  },

  // Run your day
  {
    key: 'scheduling',
    group: 'run_your_day',
    label: 'planRowScheduling',
    hint: 'planHintScheduling',
    card: 'planCardScheduling',
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
    features: ['scheduling'],
  },
  {
    key: 'expenses',
    group: 'run_your_day',
    label: 'planRowExpenses',
    hint: 'planHintExpenses',
    card: 'planCardExpenses',
    features: ['expenses'],
    limit: 'expenses_per_month',
  },
  {
    key: 'documents',
    group: 'run_your_day',
    label: 'planRowDocuments',
    hint: 'planHintDocuments',
    card: 'planCardDocuments',
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
    card: 'planCardDashboard',
    features: ['dashboard_reports'],
  },

  // Work with clients
  {
    key: 'clients',
    group: 'work_with_clients',
    label: 'planRowClients',
    hint: 'planHintClients',
    card: 'planCardClients',
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
    card: 'planCardEngagements',
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
    card: 'planCardSignatures',
    features: ['simple_signatures'],
    limit: 'signatures_per_month',
  },
  {
    key: 'contracts',
    group: 'work_with_clients',
    label: 'planRowContracts',
    hint: 'planHintContracts',
    card: 'planCardContracts',
    features: ['document_templates'],
  },
  {
    key: 'portal',
    group: 'work_with_clients',
    label: 'planRowPortal',
    hint: 'planHintPortal',
    card: 'planCardPortal',
    features: ['client_portal', 'custom_portal_domain'],
  },

  // Automate with AI
  {
    key: 'heidi',
    group: 'automate_ai',
    label: 'planRowHeidi',
    hint: 'planHintHeidi',
    card: 'planCardHeidi',
    features: ['heidi'],
    limit: 'ai_tokens_per_month',
  },
  {
    key: 'ai_import',
    group: 'automate_ai',
    label: 'planRowAIImport',
    hint: 'planHintAIImport',
    card: 'planCardAIImport',
    features: ['ai_import'],
    limit: 'ai_automation_tokens_per_month',
  },
  {
    key: 'ai_filing',
    group: 'automate_ai',
    label: 'planRowAIFiling',
    hint: 'planHintAIFiling',
    card: 'planCardAIFiling',
    features: ['ai_import'],
  },
  {
    key: 'automations',
    group: 'automate_ai',
    label: 'planRowAutomations',
    hint: 'planHintAutomations',
    card: 'planCardAutomations',
    features: ['automations', 'engagement_automation'],
    limit: 'automation_actions_per_month',
  },
  {
    key: 'api',
    group: 'automate_ai',
    label: 'planRowAPI',
    hint: 'planHintAPI',
    card: 'planCardAPI',
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
    card: 'planCardBooks',
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
    card: 'planCardDataExport',
    features: ['data_export'],
  },
  {
    key: 'approvals',
    group: 'team_compliance',
    label: 'planRowApprovals',
    hint: 'planHintApprovals',
    card: 'planCardApprovals',
    features: ['document_approvals'],
  },
  {
    key: 'employees',
    group: 'team_compliance',
    label: 'planRowEmployees',
    hint: 'planHintEmployees',
    card: 'planCardEmployees',
    features: ['employees'],
  },
  {
    key: 'branding',
    group: 'team_compliance',
    label: 'planRowBranding',
    hint: 'planHintBranding',
    card: 'planCardBranding',
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

/** Each card's headline, who it is for, and the 3–4 rows (by key) it leads with in bold. */
const PLAN_COPY: PerPlan<{ headline: MessageKey; bestFor: MessageKey; heroes: string[] }> = {
  free: {
    headline: 'planHeadlineFree',
    bestFor: 'planBestForFree',
    heroes: ['invoices', 'swiss_qr', 'scheduling', 'expenses'],
  },
  basic: { headline: 'planHeadlineBasic', bestFor: 'planBestForBasic', heroes: [] },
  pro: {
    headline: 'planHeadlinePro',
    bestFor: 'planBestForPro',
    heroes: ['heidi', 'ai_import', 'signatures', 'reminders'],
  },
  business: {
    headline: 'planHeadlineBusiness',
    bestFor: 'planBestForBusiness',
    heroes: ['portal', 'einvoice', 'approvals', 'employees'],
  },
}

/** The allowances each card lists under its features, in this order. */
const CARD_LIMITS: { limit: PlanLimit; label: MessageKey }[] = [
  { limit: 'people', label: 'planLimitPeople' },
  { limit: 'clients', label: 'planLimitClients' },
  { limit: 'invoices_per_month', label: 'planLimitInvoices' },
  { limit: 'quotes_per_month', label: 'planLimitQuotes' },
  { limit: 'expenses_per_month', label: 'planLimitExpenses' },
  { limit: 'scheduled_events_per_month', label: 'planLimitSessions' },
  { limit: 'storage_bytes', label: 'planLimitStorage' },
  { limit: 'emails_per_month', label: 'planLimitEmails' },
]

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
export type PlanLimitLine = { key: string; label: string; amount: string }
export type PlanCardData = {
  plan: PlanId
  name: string
  headline: string
  bestFor: string
  /** The plan's lead features, in bold. */
  heroes: PlanLine[]
  /** "Everything in Free, plus:" for every plan but the first. */
  basis?: string
  /** The rest of what the plan has (or adds to the one before), by group; empty groups left out. */
  groups: { group: PlanGroup; title: string; lines: PlanLine[] }[]
  limits: PlanLimitLine[]
}

/**
 * Each plan's card: the first plan's features in full, every other one "Everything in <the plan before>, plus:" what
 * it adds; its heroes first, then the rest by group; then its allowances.
 */
export function planCards(offer: PlanCatalogue, language: Locale): PlanCardData[] {
  const translate = translatorFor(language)
  const carded = ROWS.filter((row) => row.card)
  const line = (row: RowDef): PlanLine => ({
    key: row.key,
    label: translate(row.card ?? row.label),
  })

  return offer.plans.map(({ id, name }, index) => {
    const below = offer.plans[index - 1]
    const shown = carded.filter(
      (row) => hasRow(offer, row, id) && !(below && hasRow(offer, row, below.id)),
    )
    const heroes = PLAN_COPY[id].heroes.flatMap((key) => {
      const row = shown.find((r) => r.key === key)
      return row ? [line(row)] : []
    })
    const rest = shown.filter((row) => !PLAN_COPY[id].heroes.includes(row.key))
    return {
      plan: id,
      name,
      headline: translate(PLAN_COPY[id].headline),
      bestFor: translate(PLAN_COPY[id].bestFor),
      heroes,
      basis: below
        ? translate(shown.length ? 'planEverythingIn' : 'planEverythingInMoreRoom', {
            plan: below.name,
          })
        : undefined,
      groups: PLAN_GROUPS.map((group) => ({
        group,
        title: translate(GROUP_TITLES[group]),
        lines: rest.filter((row) => row.group === group).map(line),
      })).filter((group) => group.lines.length > 0),
      limits: CARD_LIMITS.map(({ limit, label }) => ({
        key: limit,
        label: translate(label),
        amount: planAllowance(offer, limit, id, language)?.amount ?? '–',
      })),
    }
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

/** The note under the plans: what the per-person amounts mean, and that clients use the portal for free. */
export const planFootnote = (language: Locale) => translatorFor(language)('planFootnote')
