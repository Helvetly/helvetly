import { describe, expect, it } from 'vitest'

import { translatorFor } from './i18n'
import {
  PLAN_GROUPS,
  PLAN_IDS,
  planAllowance,
  type PlanCatalogue,
  planCards,
  planComparison,
  type PlanId,
  ROW_FEATURES,
} from './plan-features'

const from = (cheapest: PlanId) => {
  const has = (id: PlanId) => PLAN_IDS.indexOf(id) >= PLAN_IDS.indexOf(cheapest)
  return { free: has('free'), basic: has('basic'), pro: has('pro'), business: has('business') }
}
const BUSINESS = new Set([
  'client_portal',
  'custom_portal_domain',
  'einvoice_xml',
  'employees',
  'document_approvals',
])
const PRO = new Set([
  'heidi',
  'ai_import',
  'automations',
  'invoice_reminders',
  'invoice_instalments',
  'invoice_corrections',
  'engagement_automation',
  'document_templates',
  'simple_signatures',
  'vat_returns',
  'ledger_exports',
  'data_export',
  'remove_branding',
])
const cap = (free: number, basic: number, pro: number, business: number | null) => ({
  period: 'calendar_month_utc',
  plans: {
    free: { included: free !== 0, value: free },
    basic: { included: basic !== 0, value: basic },
    pro: { included: pro !== 0, value: pro },
    business: { included: business !== 0, value: business },
  },
})

const offer: PlanCatalogue = {
  plans: [
    { id: 'free', name: 'Free' },
    { id: 'basic', name: 'Basic' },
    { id: 'pro', name: 'Pro' },
    { id: 'business', name: 'Business' },
  ],
  features: Object.fromEntries(
    ROW_FEATURES.map((key) => [
      key,
      from(
        BUSINESS.has(key)
          ? 'business'
          : PRO.has(key)
            ? 'pro'
            : key === 'calendar_sync'
              ? 'basic'
              : 'free',
      ),
    ]),
  ),
  max_self_service_seats: { free: 1, basic: 5, pro: 25, business: null },
  limits: {
    clients: { ...cap(5, 30, 300, null), period: null },
    invoices_per_month: cap(3, 15, 100, null),
    signatures_per_month: cap(0, 0, 50, null),
    storage_bytes: {
      ...cap(100_000_000, 500_000_000, 5_000_000_000, 20_000_000_000),
      period: null,
    },
    ai_tokens_per_month: cap(0, 0, 5_000_000, 20_000_000),
  },
}
const cards = planCards(offer, 'en')
const table = planComparison(offer, 'en')
const card = (plan: PlanId) => cards.find((c) => c.plan === plan)
const featureLabels = (plan: PlanId) => card(plan)?.features.map((l) => l.label)

describe('planCards', () => {
  it('gives each paid plan a short tagline and its five lead features', () => {
    expect(featureLabels('basic')).toEqual([
      'Invoices & Swiss QR bills',
      'Scheduling & booking links',
      'Expenses & receipts',
      'Reports & period closing',
      'Up to 5 people',
    ])
    expect(featureLabels('pro')).toEqual([
      'Everything in Basic',
      'Heidi AI assistant',
      'AI import & smart capture',
      'E-signatures & contracts',
      'Automatic reminders',
    ])
    expect(featureLabels('business')).toEqual([
      'Everything in Pro',
      'White-label client portal',
      'E-invoices',
      'Approvals',
      'Employees & payroll',
    ])
    for (const c of cards) {
      expect(c.tagline.split(' ').length).toBeLessThanOrEqual(5)
      expect(c.features.length).toBeLessThanOrEqual(5)
      for (const line of c.features) expect(line.label.split(' ').length).toBeLessThanOrEqual(5)
    }
  })

  it('leaves out a lead feature the plan does not have', () => {
    const noHeidi = { ...offer, features: { ...offer.features, heidi: from('business') } }
    const pro = planCards(noHeidi, 'en').find((c) => c.plan === 'pro')
    expect(pro?.features.map((l) => l.key)).not.toContain('heidi')
  })

  it('sums up its allowances in three short stats, in words, never ∞', () => {
    expect(card('basic')?.stats).toEqual(['15 invoices / mo', '30 clients', '500 MB'])
    expect(card('business')?.stats).toEqual(['Unlimited invoices', 'Unlimited clients', '20 GB'])
    for (const c of cards) expect(c.stats.length).toBeLessThanOrEqual(3)
    expect(JSON.stringify(cards)).not.toContain('∞')
  })
})

describe('AI import wording', () => {
  it('names it "AI import & smart capture" in English and translates it in every language', () => {
    const en = translatorFor('en')
    expect(en('planRowAIImport')).toBe('AI import & smart capture')
    expect(en('planCardAIImport')).toBe('AI import & smart capture')
    expect(en('planHintAIImport')).toBe(
      'Drop PDFs, photos or spreadsheets — invoices, clients and expenses are created for you.',
    )
    for (const language of ['de', 'fr', 'it', 'nl', 'cs', 'sv'] as const) {
      const translate = translatorFor(language)
      expect(translate('planRowAIImport')).toBe(translate('planCardAIImport'))
      expect(translate('planRowAIImport')).not.toBe(en('planRowAIImport'))
      expect(translate('planHintAIImport')).not.toBe(en('planHintAIImport'))
    }
  })
})

describe('planComparison', () => {
  it('has the groups of the cards, in their order, each row once', () => {
    expect(table.map((g) => g.group)).toEqual([...PLAN_GROUPS])
    const keys = table.flatMap((g) => g.rows.map((r) => r.key))
    expect(new Set(keys).size).toBe(keys.length)
    const labels = table.flatMap((g) => g.rows.map((r) => r.label))
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('shows ticks, dashes, amounts with their unit and Unlimited', () => {
    const row = (key: string) => table.flatMap((g) => g.rows).find((r) => r.key === key)
    expect(row('invoices')?.cells).toEqual({
      free: { kind: 'amount', amount: '3', unit: '/ month' },
      basic: { kind: 'amount', amount: '15', unit: '/ month' },
      pro: { kind: 'amount', amount: '100', unit: '/ month' },
      business: { kind: 'amount', amount: 'Unlimited' },
    })
    expect(row('clients')?.cells.pro).toEqual({ kind: 'amount', amount: '300' })
    expect(row('signatures')?.cells.basic).toEqual({ kind: 'no' })
    expect(row('portal')?.cells.business).toEqual({ kind: 'yes' })
    expect(row('api')?.cells.basic).toEqual({ kind: 'no' })
    expect(row('languages')?.cells.free).toEqual({ kind: 'yes' })
    expect(JSON.stringify(table)).not.toContain('∞')
  })

  it('explains a row in its (?) where it has one', () => {
    const einvoice = table.flatMap((g) => g.rows).find((r) => r.key === 'einvoice')
    expect(einvoice?.hint).toMatch(/XRechnung/)
  })
})

describe('planAllowance', () => {
  it('says what a plan includes: a count, bytes, tokens, Unlimited, or nothing', () => {
    expect(planAllowance(offer, 'clients', 'basic', 'en')?.amount).toBe('30')
    expect(planAllowance(offer, 'storage_bytes', 'free', 'en')?.amount).toBe('100 MB')
    expect(planAllowance(offer, 'ai_tokens_per_month', 'pro', 'en')?.amount).toBe('5M')
    expect(planAllowance(offer, 'clients', 'business', 'de')?.amount).toBe('Unbegrenzt')
    expect(planAllowance(offer, 'signatures_per_month', 'basic', 'en')).toBeUndefined()
  })
})
