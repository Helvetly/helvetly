import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { INTERNAL_ROWS, planAllowance } from '@helvetly/ui/lib/plan-features'
import { describe, expect, it } from 'vitest'

import { faqIn } from './faq'
import { projectPlans } from './offer'
import {
  extraPersonOf,
  has,
  OFFER_FEATURE_KEYS,
  PLAN_IDS,
  plansIn,
  priceOf,
  SELF_SERVICE_SEATS,
  totalOf,
  TRIAL,
  USAGE_DETAILS,
  YEARLY_DISCOUNT_PERCENT,
  yearlyTerms,
} from './plans'

const { BENEFITS, bytes, LIMITS, PLANS, plansWith, tokens, planById } = plansIn('en')

const api = join(__dirname, '../../../api/internal')
const go = readFileSync(join(api, 'billing/plans.go'), 'utf8')

/** A Go map literal of plans.go by its name: `monthly = map[string]int64{Basic: 1900, …}`. */
function goMap(name: string): Record<string, number> {
  const body = new RegExp(`${name}\\s*=\\s*map\\[string\\]int64\\{([^}]*)\\}`).exec(go)?.[1] ?? ''
  return Object.fromEntries(
    [...body.matchAll(/(\w+): (\d+)/g)].map(([, plan, value]) => [
      plan?.toLowerCase(),
      Number(value),
    ]),
  )
}

// The offer document migration 00065 seeds: its records, and its trial.
const sql = readFileSync(join(api, 'store/migrations/00065_offer_reset.sql'), 'utf8')
const document: {
  trial: { days: number; seats: number; access_plan: string }
  records: {
    key: string
    type: string
    values: Record<string, { state: string; value?: number }>
  }[]
} = JSON.parse(sql.slice(sql.indexOf("now(), '") + "now(), '".length, sql.indexOf("\n}')") + 2))

const access = new Map(
  document.records
    .filter((r) => r.type === 'access')
    .map((r) => [r.key, PLAN_IDS.filter((id) => r.values[id]?.state === 'enabled')]),
)

describe('plans', () => {
  it('match the tiered prices and the discount in plans.go', () => {
    const paid = PLANS.filter((plan) => plan.id !== 'free')
    expect(goMap('monthly')).toEqual(Object.fromEntries(paid.map((p) => [p.id, p.monthly * 100])))
    expect(goMap('extraMonthly')).toEqual(
      Object.fromEntries(paid.map((p) => [p.id, p.extraMonthly * 100])),
    )
    expect(goMap('included')).toEqual(
      Object.fromEntries(PLANS.map((p) => [p.id, p.includedPeople])),
    )
    expect(go).toContain(`yearlyDiscountPercent = ${YEARLY_DISCOUNT_PERCENT}`)
  })

  it('price a base, an extra person and a team as the API charges them, in rappen', () => {
    expect(PLANS.map((plan) => priceOf(plan, 'month').amount)).toEqual([0, 1900, 4900, 9900])
    expect(PLANS.map((plan) => priceOf(plan, 'year').amount)).toEqual([0, 18300, 47100, 95100])
    expect(PLANS.map((plan) => extraPersonOf(plan, 'year').amount)).toEqual([0, 9600, 14400, 19200])
    // Pro for 4 people: the base for 2, and 2 more.
    expect(totalOf(planById('pro'), 'month', 4).amount).toBe(4900 + 2 * 1500)
    expect(totalOf(planById('business'), 'year', 3).amount).toBe(95100)
  })

  it('keep the trial the offer seeds', () => {
    expect(document.trial).toMatchObject({ days: TRIAL.days, seats: TRIAL.members })
    expect(document.trial.access_plan).toBe(TRIAL.plan)
  })

  it('give each feature to the plans the offer does', () => {
    for (const key of OFFER_FEATURE_KEYS)
      expect({ [key]: PLAN_IDS.filter((id) => has(id, key)) }).toEqual({
        [key]: access.get(key) ?? [],
      })
  })

  it('give the table’s rows of features the public offer leaves out the plans the offer does', () => {
    for (const { feature, from } of INTERNAL_ROWS)
      expect({ [feature]: PLAN_IDS.slice(PLAN_IDS.indexOf(from)) }).toEqual({
        [feature]: access.get(feature),
      })
  })

  it('give each allowance the values the offer does', () => {
    const records = new Map(document.records.map((r) => [r.key, r.values]))
    for (const [key, limit] of Object.entries(LIMITS)) {
      const seeded = Object.fromEntries(
        PLAN_IDS.map((id) => {
          const v = records.get(key)?.[id]
          return [id, v?.state === 'unlimited' ? 'unlimited' : v?.value ? v.value : null]
        }),
      )
      expect({ [key]: limit.values }).toEqual({ [key]: seeded })
    }
  })
})

describe('offer helvetly-v2 public projection', () => {
  it('compares the sixteen business benefits', () => {
    expect(BENEFITS.map((b) => b.key)).toEqual([
      'invoicing',
      'swiss_qr',
      'revolut',
      'engagements',
      'scheduling',
      'automations',
      'heidi',
      'client_portal',
      'expenses',
      'ai_import',
      'documents_signatures',
      'corrections_vat',
      'einvoice_xml',
      'ledger_exports',
      'employees',
      'remove_branding',
    ])
  })

  it('shows twelve allowances, workspace caps apart from per-team-member pools', () => {
    expect(USAGE_DETAILS).toHaveLength(12)
    expect(USAGE_DETAILS.filter((k) => LIMITS[k].scope === 'workspace')).toEqual([
      'clients',
      'products',
      'engagements',
      'scheduled_events_per_month',
    ])
  })

  it.each([
    ['clients', ['5', '30', '300', 'Unlimited']],
    ['products', ['10', '25', '250', 'Unlimited']],
    ['engagements', ['1', '3', '20', 'Unlimited']],
    ['invoices_per_month', ['3', '15', '100', 'Unlimited']],
    ['quotes_per_month', ['3', '5', '100', 'Unlimited']],
    ['expenses_per_month', ['1', '10', '300', 'Unlimited']],
    ['scheduled_events_per_month', ['3', '10', '100', 'Unlimited']],
    ['signatures_per_month', [null, null, '50', 'Unlimited']],
    ['storage_bytes', ['100 MB', '500 MB', '5 GB', '20 GB']],
    ['emails_per_month', ['20', '100', '500', '2’000']],
    ['ai_tokens_per_month', [null, null, '5M', '20M']],
    ['automation_actions_per_month', [null, null, '1’500', '6’000']],
  ] as const)('%s per plan, as the pricing cards and the table show it', (key, expected) => {
    const offer = projectPlans()
    expect(PLAN_IDS.map((id) => planAllowance(offer, key, id, 'en')?.amount ?? null)).toEqual(
      expected,
    )
  })

  it('keeps AI, the portal and XML out of the free plans', () => {
    expect(has('free', 'expenses')).toBe(true)
    expect(has('basic', 'scheduling')).toBe(true)
    expect(has('basic', 'ai_import')).toBe(false)
    expect(has('basic', 'remove_branding')).toBe(false)
    expect(plansWith('heidi')).toBe('Pro or Business')
    expect(plansWith('heidi', 'conjunction')).toBe('Pro and Business')
    expect(plansWith('client_portal')).toBe('Business')
    expect(plansWith('bank_sync')).toBe('')
  })

  it('gives each plan its own people limit, the owner included, and Business none', () => {
    expect(SELF_SERVICE_SEATS).toEqual({ free: 1, basic: 5, pro: 25, business: null })
    const offer = projectPlans()
    expect(PLAN_IDS.map((id) => planAllowance(offer, 'people', id, 'en')?.amount)).toEqual([
      '1',
      '5',
      '25',
      'Unlimited',
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

/** "CHF 1'413", "1.431", "15.25", "39,25" back to rappen: a separator before exactly two digits at the end is the decimal one. */
const rappen = (shown: string) => {
  const digits = shown.replace(/[^\d.,]/g, '')
  const cents = /[.,](\d{2})$/.exec(digits)
  const whole = (cents ? digits.slice(0, -3) : digits).replace(/[.,]/g, '')
  return Number(whole) * 100 + Number(cents?.[1] ?? 0)
}

const PAID = PLANS.filter((plan) => plan.id !== 'free')

describe('yearly prices as the cards show them', () => {
  it.each(PAID.map((plan) => [plan.id, plan] as const))(
    '%s: twelve of the month shown make the year billed, to the rappen, and the saving is the difference',
    (_, plan) => {
      for (const language of ['en', 'de', 'nl'] as const) {
        const { perMonth, billed, saving } = yearlyTerms(plan, language)
        const year = priceOf(plan, 'year').amount
        expect(Math.abs(rappen(perMonth) * 12 - year)).toBeLessThanOrEqual(12)
        expect(rappen(billed)).toBe(year)
        expect(rappen(saving)).toBe(priceOf(plan, 'month').amount * 12 - year)
      }
    },
  )

  it('words them with rappen and in the page language', () => {
    expect(PAID.map((plan) => yearlyTerms(plan, 'en'))).toEqual([
      { perMonth: '15.25', billed: 'CHF 183', saving: 'CHF 45' },
      { perMonth: '39.25', billed: 'CHF 471', saving: 'CHF 117' },
      { perMonth: '79.25', billed: 'CHF 951', saving: 'CHF 237' },
    ])
    expect(PAID.map((plan) => yearlyTerms(plan, 'de', 'eur').saving)).toEqual([
      'EUR 45',
      'EUR 117',
      'EUR 237',
    ])
  })
})
