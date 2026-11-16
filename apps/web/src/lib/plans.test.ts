import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BENEFITS,
  bytes,
  formatLimit,
  has,
  LIMITS,
  PLAN_IDS,
  PLANS,
  plansWith,
  priceOf,
  tokens,
  USAGE_DETAILS,
  YEARLY_DISCOUNT_PERCENT,
} from './plans'

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

describe('offer v2 public projection', () => {
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

  it('shows eleven allowances, workspace caps apart from per-person pools', () => {
    expect(USAGE_DETAILS).toHaveLength(11)
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
    ['clients', ['30', '300', '1’500']],
    ['products', ['25', '250', '1’000']],
    ['invoices_per_month', ['15', '150', '600']],
    ['expenses_per_month', [null, '300', '1’200']],
    ['signatures_per_month', [null, '50', '200']],
    ['storage_bytes', ['500 MB', '5 GB', '20 GB']],
    ['download_bytes_per_month', ['2 GB', '20 GB', '100 GB']],
    ['emails_per_month', ['100', '1’000', '5’000']],
    ['email_attachment_bytes_per_month', ['100 MB', '1 GB', '5 GB']],
    ['ai_tokens_per_month', ['250’000', '5’000’000', '20’000’000']],
    ['automation_actions_per_month', [null, '1’500', '6’000']],
  ] as const)('%s per plan', (key, expected) => {
    expect(PLAN_IDS.map((id) => formatLimit(key, id))).toEqual(expected)
  })

  it('leaves Basic a manual invoicing plan, and keeps the portal and XML for Business', () => {
    const cells = Object.fromEntries(BENEFITS.map((b) => [b.key, PLAN_IDS.map(b.cell)]))
    expect(cells.invoicing).toEqual([
      '15 new invoice issues/person/month',
      '150 new invoice issues/person/month',
      '600 new invoice issues/person/month',
    ])
    expect(cells.engagements).toEqual([
      '3 active per workspace, manual workflows',
      '20 active per workspace',
      '100 active per workspace',
    ])
    // Basic's import tokens do not make Heidi available.
    expect(cells.heidi).toEqual([
      null,
      'Included; shared 5M AI tokens/person/month',
      'Included; shared 20M AI tokens/person/month',
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

  it('formats decimal bytes and short tokens', () => {
    expect(bytes(500_000_000)).toBe('500 MB')
    expect(bytes(1_000_000_000)).toBe('1 GB')
    expect(tokens(250_000)).toBe('250’000')
    expect(tokens(20_000_000)).toBe('20M')
  })
})
