import { describe, expect, it } from 'vitest'

import { monthlyFor, TEAM_SIZES, type TieredPlanId, yearlyFor } from './team-pricing'

const year = (plan: TieredPlanId) => TEAM_SIZES.map((n) => yearlyFor(plan, n))

describe('team prices', () => {
  it('charge each plan its included people, then every extra person', () => {
    expect([monthlyFor('basic', 1), monthlyFor('basic', 3), monthlyFor('basic', 5)]).toEqual([
      19, 39, 59,
    ])
    expect([monthlyFor('pro', 1), monthlyFor('pro', 2), monthlyFor('pro', 5)]).toEqual([49, 49, 94])
    expect([
      monthlyFor('business', 1),
      monthlyFor('business', 5),
      monthlyFor('business', 6),
    ]).toEqual([149, 149, 169])
  })

  it('bill a year with 20 % off, rounded up to the franc', () => {
    expect(year('basic')).toEqual([183, 375, 567])
    expect(year('pro')).toEqual([471, 615, 903])
    expect(year('business')).toEqual([1431, 1431, 1431])
  })
})
