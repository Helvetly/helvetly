import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { faqIn } from './faq'
import {
  has,
  PLAN_IDS,
  plansIn,
  priceOf,
  SELF_SERVICE_SEATS,
  USAGE_DETAILS,
  YEARLY_DISCOUNT_PERCENT,
} from './plans'

const { BENEFITS, bytes, formatLimit, LIMITS, PLANS, plansWith, tokens, FEATURE_GROUPS } =
  plansIn('en')

const api = join(__dirname, '../../../api/internal')

describe('plans', () => {
  it('match the monthly prices and the discount in plans.go', () => {
    const go = readFileSync(join(api, 'billing/plans.go'), 'utf8')
    for (const plan of PLANS) {
      const cents = new RegExp(`${plan.name}: (\\d+)`).exec(go.split('var monthly')[1] ?? '')
      expect({ [plan.id]: Number(cents?.[1]) / 100 }).toEqual({ [plan.id]: plan.monthly })
    }
    expect(go).toContain(`yearlyDiscountPercent = ${YEARLY_DISCOUNT_PERCENT}`)
  })

  it('price a month and a year as the API charges them, in rappen', () => {
    expect(PLANS.map((plan) => priceOf(plan, 'month').amount)).toEqual([1900, 4900, 9900])
    expect(PLANS.map((plan) => priceOf(plan, 'year').amount)).toEqual([18300, 47100, 95100])
  })
})

describe('full comparison', () => {
  // The offer's access features as seeded: key -> plans with the feature on.
  const sql = readFileSync(join(api, 'store/migrations/00007_offers.sql'), 'utf8')
  const offer: {
    records: { key: string; type: string; values: Record<string, { state: string }> }[]
  } = JSON.parse(sql.slice(sql.indexOf("now(), '") + "now(), '".length, sql.indexOf("\n');")))
  const seeded = new Map(
    offer.records
      .filter((r) => r.type === 'access')
      .map((r) => [r.key, PLAN_IDS.filter((id) => r.values[id]?.state === 'enabled')]),
  )
  const rows = FEATURE_GROUPS.flatMap((g) => g.rows).filter((r) => !(r.key in LIMITS))

  it('gives each feature to the plans the offer does', () => {
    for (const row of rows)
      expect({ [row.key]: PLAN_IDS.filter((id) => row.plans[id]) }).toEqual({
        [row.key]: seeded.get(row.key),
      })
  })

  it('lists every feature some plan includes', () => {
    const offered = [...seeded].filter(([, plans]) => plans.length > 0).map(([key]) => key)
    expect(rows.map((r) => r.key).toSorted()).toEqual(offered.toSorted())
  })
})

describe('offer helvetly public projection', () => {
  it('compares the thirteen business benefits', () => {
    expect(BENEFITS.map((b) => b.key)).toEqual([
      'invoicing',
      'swiss_qr',
      'revolut',
      'engagements',
      'automations',
      'heidi',
      'client_portal',
      'expenses',
      'documents_signatures',
      'corrections_vat',
      'einvoice_xml',
      'ledger_exports',
      'employees',
    ])
  })

  it('shows ten allowances, workspace caps apart from per-team-member pools', () => {
    expect(USAGE_DETAILS).toHaveLength(10)
    expect(USAGE_DETAILS.filter((k) => LIMITS[k].scope === 'workspace')).toEqual([
      'clients',
      'products',
    ])
    expect(LIMITS.engagements.scope).toBe('workspace')
  })

  it('keeps technical records out of the public tables', () => {
    const shown = [...BENEFITS.map((b) => b.key), ...USAGE_DETAILS].join(' ')
    for (const hidden of ['identity', 'role', 'audit', 'api', 'mcp', 'cost', 'credit', 'draft'])
      expect(shown).not.toContain(hidden)
  })

  it.each([
    ['clients', ['30', '300', 'Unlimited']],
    ['products', ['25', '250', 'Unlimited']],
    ['engagements', ['3', '20', 'Unlimited']],
    ['invoices_per_month', ['15', '100', 'Unlimited']],
    ['quotes_per_month', ['5', '100', 'Unlimited']],
    ['expenses_per_month', [null, '300', 'Unlimited']],
    ['signatures_per_month', [null, '50', 'Unlimited']],
    ['storage_bytes', ['500 MB', '5 GB', '20 GB']],
    ['emails_per_month', ['100', '500', '2’000']],
    ['ai_tokens_per_month', [null, '5M', '20M']],
    ['automation_actions_per_month', [null, '1’500', '6’000']],
  ] as const)('%s per plan', (key, expected) => {
    expect(PLAN_IDS.map((id) => formatLimit(key, id))).toEqual(expected)
  })

  it('leaves Basic a manual invoicing plan, and keeps the portal and XML for Business', () => {
    const cells = Object.fromEntries(BENEFITS.map((b) => [b.key, PLAN_IDS.map(b.cell)]))
    expect(cells.invoicing).toEqual([
      '15 invoices and 5 quotes / month',
      '100 invoices and 100 quotes / month',
      'Unlimited',
    ])
    expect(cells.engagements).toEqual([
      '3 active per workspace, manual workflows',
      '20 active per workspace',
      'Unlimited',
    ])
    expect(cells.automations).toEqual([
      null,
      '1’500 automated actions / month',
      '6’000 automated actions / month',
    ])
    expect(cells.expenses).toEqual([null, '300 expenses / month', 'Unlimited'])
    expect(cells.heidi).toEqual([
      null,
      'Included; 5M AI tokens / month',
      'Included; 20M AI tokens / month',
    ])
    for (const key of [
      'automations',
      'expenses',
      'documents_signatures',
      'corrections_vat',
      'ledger_exports',
    ])
      expect(cells[key]?.[0]).toBeNull()
    expect(cells.client_portal).toEqual([null, null, 'Included'])
    expect(cells.einvoice_xml).toEqual([null, null, 'Included'])
    expect(cells.employees).toEqual([null, null, 'Included'])
    expect(has('basic', 'heidi')).toBe(false)
    expect(plansWith('heidi')).toBe('Pro or Business')
    expect(plansWith('heidi', 'conjunction')).toBe('Pro and Business')
    expect(plansWith('client_portal')).toBe('Business')
  })

  it('says what Business does not cap only where the offer sets no cap', () => {
    const uncapped = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).filter(
      (key) => LIMITS[key].values.business === 'unlimited',
    )
    expect(uncapped.toSorted()).toEqual(
      [
        'clients',
        'engagements',
        'expenses_per_month',
        'invoices_per_month',
        'products',
        'quotes_per_month',
        'signatures_per_month',
      ].toSorted(),
    )
    const [basic, pro, business] = PLANS.map((p) => p.highlights)
    expect(basic).toContain('15 invoices and 5 quotes / month')
    expect(pro).toContain('100 invoices, 100 quotes and 300 expenses / month')
    expect(business).toContain('Unlimited clients, products and engagements')
    expect(business).toContain('Unlimited invoices, quotes, expenses and signature requests')
    expect(PLANS.flatMap((p) => p.highlights).join(' ')).not.toMatch(/per (paid )?person/)
    // The scope is said once in the legend, not on every feature line.
    expect(PLANS.flatMap((p) => p.highlights).join(' ')).not.toMatch(/team member/)
  })

  it('quotes the quotes allowance and explains automated actions in the full comparison', () => {
    const rows = FEATURE_GROUPS.flatMap((g) => g.rows)
    expect(rows.find((r) => r.key === 'quotes')?.limit).toBe('quotes_per_month')
    const automations = rows.find((r) => r.key === 'automations')
    expect(automations?.label).toBe('Automated actions')
    expect(automations?.hint).toMatch(/counts once/)
  })

  it('gives each plan its own people limit, the owner included, and Business none', () => {
    expect(SELF_SERVICE_SEATS).toEqual({ basic: 5, pro: 25, business: null })
    expect(PLANS.map((p) => p.highlights[0])).toEqual([
      'Up to 5 people',
      'Up to 25 people',
      'Unlimited people',
    ])
  })

  it('says each plan’s people limit in the FAQ answer as the plans do', () => {
    const answer = String(faqIn('en').find((f) => f.id === 'price-per-person')?.a)
    expect(answer).toContain(String(SELF_SERVICE_SEATS.basic))
    expect(answer).toContain(String(SELF_SERVICE_SEATS.pro))
  })

  it('formats decimal bytes and short tokens', () => {
    expect(bytes(500_000_000)).toBe('500 MB')
    expect(bytes(1_000_000_000)).toBe('1 GB')
    expect(tokens(250_000)).toBe('250’000')
    expect(tokens(20_000_000)).toBe('20M')
  })
})
