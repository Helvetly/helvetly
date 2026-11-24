import { describe, expect, it } from 'vitest'

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
      from(BUSINESS.has(key) ? 'business' : PRO.has(key) ? 'pro' : 'free'),
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
const lines = (plan: PlanId) => {
  const c = card(plan)
  return [...(c?.heroes ?? []), ...(c?.groups.flatMap((g) => g.lines) ?? [])].map((l) => l.label)
}

describe('planCards', () => {
  it('leads Free with its heroes and lists everything it has', () => {
    expect(card('free')?.basis).toBeUndefined()
    expect(card('free')?.heroes.map((l) => l.key)).toEqual([
      'invoices',
      'swiss_qr',
      'scheduling',
      'expenses',
    ])
    expect(lines('free')).not.toContain('Heidi, your AI assistant')
  })

  it('gives Basic more room only, and every other plan what it adds', () => {
    expect(card('basic')?.basis).toBe('Everything in Free, with more room:')
    expect(lines('basic')).toEqual([])
    expect(card('pro')?.basis).toBe('Everything in Basic, plus:')
    expect(lines('pro')).toContain('Developer API & MCP for AI agents')
    expect(card('business')?.heroes.map((l) => l.label)).toEqual([
      'White-labelled client portal on your own domain',
      'E-invoices',
      'Approvals before invoices go out',
      'Employee records and payroll',
    ])
  })

  it('never repeats a line, on a card or between a plan and the ones below it', () => {
    const seen = cards.flatMap((c) => [...c.heroes, ...c.groups.flatMap((g) => g.lines)])
    expect(new Set(seen.map((l) => l.key)).size).toBe(seen.length)
    expect(new Set(seen.map((l) => l.label)).size).toBe(seen.length)
  })

  it('groups the rest in the one group order, never an empty group', () => {
    for (const c of cards) {
      const order = c.groups.map((g) => PLAN_GROUPS.indexOf(g.group))
      expect(order).toEqual(order.toSorted((a, b) => a - b))
      expect(c.groups.every((g) => g.lines.length > 0)).toBe(true)
    }
  })

  it('lists the allowances in words, never ∞', () => {
    expect(card('business')?.limits.find((l) => l.key === 'people')?.amount).toBe('Unlimited')
    expect(card('pro')?.limits.find((l) => l.key === 'storage_bytes')?.amount).toBe('5 GB')
    expect(JSON.stringify(cards)).not.toContain('∞')
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
