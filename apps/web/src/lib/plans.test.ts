import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { planAllowance } from '@helvetly/ui/lib/plan-features'
import { describe, expect, it } from 'vitest'

import { faqIn } from './faq'
import { planLines, projectPlans } from './offer'
import {
  has,
  PLAN_IDS,
  plansIn,
  priceOf,
  SELF_SERVICE_SEATS,
  USAGE_DETAILS,
  YEARLY_DISCOUNT_PERCENT,
} from './plans'

const { BENEFITS, bytes, LIMITS, PLANS, plansWith, tokens, FEATURE_GROUPS } = plansIn('en')

const api = join(__dirname, '../../../api/internal')

/** A card's lines as read: "300 clients", "∞ quotes / month". */
const text = (plan: number) =>
  planLines('en')[plan]?.lines.map((l) => [l.amount, l.label].filter(Boolean).join(' '))

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
  // Business-only features added to every offer after the seed.
  const added = [
    ['custom_portal_domain', '00032_workspace_domains.sql'],
    ['document_approvals', '00039_document_approvals.sql'],
  ] as const
  for (const [key] of added) seeded.set(key, ['business'])

  it('takes the features added later from their migrations', () => {
    for (const [key, file] of added)
      expect(readFileSync(join(api, 'store/migrations', file), 'utf8')).toContain(
        `'${key}', CASE plan_id WHEN 'business' THEN 'enabled' ELSE 'disabled' END`,
      )
  })
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
    ['clients', ['30', '300', '∞']],
    ['products', ['25', '250', '∞']],
    ['engagements', ['3', '20', '∞']],
    ['invoices_per_month', ['15', '100', '∞']],
    ['quotes_per_month', ['5', '100', '∞']],
    ['expenses_per_month', [null, '300', '∞']],
    ['signatures_per_month', [null, '50', '∞']],
    ['storage_bytes', ['500 MB', '5 GB', '20 GB']],
    ['emails_per_month', ['100', '500', '2’000']],
    ['ai_tokens_per_month', [null, '5M', '20M']],
    ['automation_actions_per_month', [null, '1’500', '6’000']],
  ] as const)('%s per plan, as the pricing cards and the table show it', (key, expected) => {
    const offer = projectPlans()
    expect(PLAN_IDS.map((id) => planAllowance(offer, key, id, 'en')?.amount ?? null)).toEqual(
      expected,
    )
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
    const business = planLines('en')[2]?.lines ?? []
    const infinite = business.filter((line) => line.amount === '∞').map((line) => line.key)
    expect(infinite).toEqual([
      'people',
      'clients',
      'products',
      'invoices',
      'quotes',
      'engagements',
      'expenses',
      'signatures',
    ])
    expect(
      business.filter((line) => line.amount === '∞').every((l) => l.spoken === 'Unlimited'),
    ).toBe(true)
  })

  it('lists on each card what the plan adds to the one before, from the offer', () => {
    expect(planLines('en').map((p) => p.basis)).toEqual([
      undefined,
      'Everything in Basic, plus:',
      'Everything in Pro, plus:',
    ])
    expect(text(0)).toEqual([
      '5 team members',
      '30 clients',
      '25 products and services',
      '15 invoices / month',
      '5 quotes / month',
      'Swiss QR bills and Revolut payment links',
      '3 ongoing engagements and retainers',
      'Books: dashboard, reports and period closing',
      '500 MB document storage',
      '100 emails to clients / month',
    ])
    expect(text(1)).toEqual([
      '300 expenses / month',
      'AI import: turn PDFs, photos and spreadsheets into invoices, clients and expenses',
      '5M AI tokens / month for Heidi, your AI assistant',
      '1’500 automated steps / month, such as payment reminders',
      '50 e-signature requests / month',
      'Document templates',
      'Payment in instalments',
      'Credit notes and invoice corrections',
      'Books: ledger, VAT returns and accounting exports',
      'API access',
      '25 team members',
      '300 clients',
      '250 products and services',
      '100 invoices / month',
      '100 quotes / month',
      '20 ongoing engagements and retainers',
      '5 GB document storage',
      '500 emails to clients / month',
    ])
    expect(text(2)).toEqual([
      'Client portal: clients view and pay invoices, accept quotes and download documents',
      'Your portal on your own domain (portal.yourcompany.ch)',
      'Approvals before invoices go out',
      'E-invoices as XML: XRechnung, ZUGFeRD and more',
      'Employees: staff records and payroll register',
      '∞ team members',
      '∞ clients',
      '∞ products and services',
      '∞ invoices / month',
      '∞ quotes / month',
      '∞ ongoing engagements and retainers',
      '∞ expenses / month',
      '20M AI tokens / month for Heidi, your AI assistant',
      '6’000 automated steps / month, such as payment reminders',
      '∞ e-signature requests / month',
      '20 GB document storage',
      '2’000 emails to clients / month',
    ])
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
    expect(planLines('en').map((p) => p.lines.find((l) => l.key === 'people')?.amount)).toEqual([
      '5',
      '25',
      '∞',
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
