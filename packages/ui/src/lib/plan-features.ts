import { type Locale, localeDetails } from '@helvetly/i18n'

import { translatorFor } from './i18n'
// The one list of what each plan includes, for the website's pricing cards and the app's plan picker alike. Every
// number comes from the offer the API publishes (GET /api/v1/public/offers/current); the wording lives here.

export type PlanId = 'basic' | 'pro' | 'business'
type PerPlan<T> = Record<PlanId, T>

/** The parts of the public offer the lines read. */
export type OfferCatalogue = {
  plans: { id: PlanId; name: string }[]
  /** Business benefits by key, and which plans include each. */
  comparison: { key: string; plans: PerPlan<boolean> }[]
  /** The most people a workspace can have, the owner included; null: no cap. */
  max_self_service_seats: PerPlan<number | null>
  /** value: for one person, null when unlimited; not included is `included: false` or 0. */
  limits: Partial<Record<string, { plans: PerPlan<{ included: boolean; value: number | null }> }>>
}

/**
 * One line of a plan: an amount first ("300", "5 GB", "∞") when it has one, then what it is. `spoken` is the amount
 * for screen readers when the glyph says nothing to them.
 */
export type FeatureLine = { key: string; amount?: string; spoken?: string; label: string }
/** A plan's lines; `basis` ("Everything in Basic, plus:") when they only add to the plan before it. */
export type PlanLines = { plan: PlanId; basis?: string; lines: FeatureLine[] }

type Translate = ReturnType<typeof translatorFor>
type LineDef = {
  key: string
  /** An allowance of the offer, or the people cap; the line shows its amount. */
  limit?: string
  /** Comparison benefits or plan feature keys that must all be included. */
  needs?: string[]
  label: (translate: Translate, count: number) => string
}

// In this order on every card. A line needs its features and, with a limit, the limit included.
const LINES: LineDef[] = [
  { key: 'people', limit: 'people', label: (t, count) => t('planLinePeople', { count }) },
  { key: 'clients', limit: 'clients', label: (t, count) => t('planLineClients', { count }) },
  { key: 'products', limit: 'products', label: (t) => t('planLineProducts') },
  { key: 'invoices', limit: 'invoices_per_month', label: (t) => t('planLineInvoices') },
  { key: 'quotes', limit: 'quotes_per_month', label: (t) => t('planLineQuotes') },
  { key: 'payments', needs: ['swiss_qr', 'revolut'], label: (t) => t('planLinePayments') },
  {
    key: 'engagements',
    limit: 'engagements',
    label: (t, count) => t('planLineEngagements', { count }),
  },
  // Every plan's books; Pro's ledger line below names what it adds.
  { key: 'books', label: (t) => t('planLineBooks') },
  {
    key: 'expenses',
    limit: 'expenses_per_month',
    needs: ['expenses'],
    label: (t) => t('planLineExpenses'),
  },
  { key: 'ai_import', needs: ['ai_import'], label: (t) => t('planLineAIImport') },
  {
    key: 'heidi',
    limit: 'ai_tokens_per_month',
    needs: ['heidi'],
    label: (t) => t('planLineHeidi'),
  },
  {
    key: 'automations',
    limit: 'automation_actions_per_month',
    needs: ['automations'],
    label: (t) => t('planLineAutomations'),
  },
  {
    key: 'signatures',
    limit: 'signatures_per_month',
    needs: ['documents_signatures'],
    label: (t) => t('planLineSignatures'),
  },
  { key: 'templates', needs: ['documents_signatures'], label: (t) => t('planLineTemplates') },
  { key: 'instalments', needs: ['invoice_instalments'], label: (t) => t('planLineInstalments') },
  { key: 'corrections', needs: ['corrections_vat'], label: (t) => t('planLineCorrections') },
  {
    key: 'ledger_exports',
    needs: ['ledger_exports', 'corrections_vat'],
    label: (t) => t('planLineLedger'),
  },
  { key: 'api_access', needs: ['api_access'], label: (t) => t('planLineAPI') },
  { key: 'client_portal', needs: ['client_portal'], label: (t) => t('planLinePortal') },
  {
    key: 'custom_portal_domain',
    needs: ['custom_portal_domain'],
    label: (t) => t('planLineDomain'),
  },
  {
    key: 'document_approvals',
    needs: ['document_approvals'],
    label: (t) => t('planLineApprovals'),
  },
  { key: 'einvoice_xml', needs: ['einvoice_xml'], label: (t) => t('planLineEInvoice') },
  { key: 'employees', needs: ['employees'], label: (t) => t('planLineEmployees') },
  { key: 'storage', limit: 'storage_bytes', label: (t) => t('planLineStorage') },
  { key: 'emails', limit: 'emails_per_month', label: (t, count) => t('planLineEmails', { count }) },
]

const MB = 1_000_000
const GB = 1_000_000_000
/** What `count` a line's plural gets for "∞": "∞ clients", never "∞ client". */
const MANY = 100

/**
 * One allowance of a plan as the lines show it: "300", "5 GB", "5M", or "∞" (with `spoken`, "Unlimited") when the plan
 * sets no cap; undefined when the plan does not include it. `limit` is an offer allowance key or `people`.
 */
export function planAllowance(
  offer: OfferCatalogue,
  limit: string,
  plan: PlanId,
  language: Locale,
): { amount: string; spoken?: string; value: number | null } | undefined {
  const value =
    limit === 'people'
      ? offer.max_self_service_seats[plan]
      : offer.limits[limit]?.plans[plan]?.included
        ? (offer.limits[limit]?.plans[plan]?.value ?? null)
        : 0
  if (value === 0) return undefined
  if (value === null)
    return { amount: '∞', spoken: translatorFor(language)('planUnlimited'), value }
  const count = (n: number) =>
    n.toLocaleString(localeDetails(language).numberLocale).replaceAll("'", '’')
  if (limit === 'storage_bytes')
    return { amount: value >= GB ? `${count(value / GB)} GB` : `${count(value / MB)} MB`, value }
  if (limit === 'ai_tokens_per_month' && value >= 1_000_000)
    return { amount: `${count(value / 1_000_000)}M`, value }
  return { amount: count(value), value }
}

/**
 * What each plan includes, as one list per plan: the first plan in full, every other one "Everything in <the plan
 * before>, plus:" what it adds first, then the allowances it raises (at their new amount). `features` gives each
 * plan's feature keys, for features the comparison does not name.
 */
export function planFeatureLines(
  offer: OfferCatalogue,
  features: (plan: PlanId) => readonly string[],
  language: Locale,
): PlanLines[] {
  const translate = translatorFor(language)
  const has = (plan: PlanId, key: string) =>
    offer.comparison.find((row) => row.key === key)?.plans[plan] ?? features(plan).includes(key)

  const linesOf = (plan: PlanId) =>
    LINES.flatMap((def): { line: FeatureLine; amount?: number | null }[] => {
      if (!(def.needs ?? []).every((key) => has(plan, key))) return []
      if (!def.limit) return [{ line: { key: def.key, label: def.label(translate, MANY) } }]
      const allowance = planAllowance(offer, def.limit, plan, language)
      if (!allowance) return []
      const { value, ...shown } = allowance
      const line = { key: def.key, ...shown, label: def.label(translate, value ?? MANY) }
      return [{ line, amount: value }]
    })

  return offer.plans.map(({ id }, index) => {
    const own = linesOf(id)
    const below = offer.plans[index - 1]
    if (!below) return { plan: id, lines: own.map(({ line }) => line) }
    const before = new Map(linesOf(below.id).map((entry) => [entry.line.key, entry.amount]))
    const added = own.filter(({ line }) => !before.has(line.key))
    const raised = own.filter(
      ({ line, amount }) => before.has(line.key) && before.get(line.key) !== amount,
    )
    return {
      plan: id,
      basis: translate('planEverythingIn', { plan: below.name }),
      lines: [...added, ...raised].map(({ line }) => line),
    }
  })
}

/** The note under the plans: what the per-person amounts mean, and that clients use the portal for free. */
export const planFootnote = (language: Locale) => translatorFor(language)('planFootnote')
