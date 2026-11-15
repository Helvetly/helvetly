import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PLANS, priceOf, YEARLY_DISCOUNT_PERCENT } from './plans'

const api = join(__dirname, '../../../api/internal')

// The latest value per plan and limit across the migrations: plan_limits rows (plan, key, max) until 00005, then
// limit_plans rows (key, plan, value; -1 unlimited). shortcut: a changed default in limits is not read; parse it
// when a migration changes one.
function migratedLimits() {
  const dir = join(api, 'store/migrations')
  const out = new Map<string, number | null>()
  for (const file of readdirSync(dir).toSorted()) {
    const up = readFileSync(join(dir, file), 'utf8').split('-- +goose Down')[0] ?? ''
    for (const m of up.matchAll(/\('(basic|pro|business)', '(\w+)', (NULL|\d+)\)/g)) {
      out.set(`${m[1]}.${m[2]}`, m[3] === 'NULL' ? null : Number(m[3]))
    }
    for (const m of up.matchAll(/\('(\w+)', '(basic|pro|business)', (-1|\d+)\)/g)) {
      out.set(`${m[2]}.${m[1]}`, m[3] === '-1' ? null : Number(m[3]))
    }
  }
  return out
}

describe('plans', () => {
  it('match the monthly prices and the discount in plans.go', () => {
    const go = readFileSync(join(api, 'billing/plans.go'), 'utf8')
    for (const plan of PLANS) {
      const cents = new RegExp(`${plan.name}: (\\d+)`).exec(go.split('var monthly')[1] ?? '')
      expect({ [plan.id]: Number(cents?.[1]) / 100 }).toEqual({ [plan.id]: plan.monthly })
    }
    expect(go).toContain(`yearlyDiscountPercent = ${YEARLY_DISCOUNT_PERCENT}`)
  })

  it('match the limit migrations', () => {
    const db = migratedLimits()
    for (const { id, limits } of PLANS) {
      expect(db.get(`${id}.members`)).toBe(limits.members)
      expect(db.get(`${id}.clients`)).toBe(limits.clients)
      expect(db.get(`${id}.invoices_per_month`)).toBe(limits.invoicesPerMonth)
      expect(db.get(`${id}.expenses_per_month`)).toBe(limits.expensesPerMonth)
      expect(db.get(`${id}.products`)).toBe(limits.products)
      expect(db.get(`${id}.engagements`)).toBe(limits.engagements)
      expect(db.get(`${id}.signatures_per_month`)).toBe(limits.signaturesPerMonth)
      expect(db.get(`${id}.storage_bytes`)).toBe(limits.storageGb * 2 ** 30)
      expect(db.get(`${id}.ai_tokens_per_month`)).toBe(limits.aiTokensPerMonth)
    }
  })

  it('price a month and a year as the API charges them, in rappen', () => {
    expect(priceOf(PLANS[1]!, 'month')).toEqual({ amount: 4900, currency: 'chf' })
    expect(PLANS.map((plan) => priceOf(plan, 'year').amount)).toEqual([18300, 47100, 95100])
  })
})
