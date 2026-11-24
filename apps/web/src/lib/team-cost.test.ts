import { describe, expect, it } from 'vitest'

import { plansIn } from './plans'
import { TEAM_SIZE, teamCost } from './team-cost'

const { planById } = plansIn('en')
const amount = (text: string) => Number(text.replace(/[^\d.]/g, ''))

describe('team cost', () => {
  it('charges every person the plan price, monthly or yearly', () => {
    expect(teamCost(planById('pro'), 3, 'month', 'en')).toEqual({
      fits: true,
      total: 'CHF 147',
      perPersonMonth: 'CHF 49',
      saving: null,
    })
    expect(teamCost(planById('pro'), 3, 'year', 'en')).toEqual({
      fits: true,
      total: "CHF 1'413",
      perPersonMonth: 'CHF 39.25',
      saving: 'CHF 351',
    })
  })

  it('makes the yearly saving twelve months less the year, for the whole team', () => {
    for (const id of ['basic', 'pro', 'business'] as const) {
      const plan = planById(id)
      for (let people = TEAM_SIZE.min; people <= 5; people++) {
        const year = teamCost(plan, people, 'year', 'en')
        const month = teamCost(plan, people, 'month', 'en')
        if (!year.fits || !month.fits || !year.saving) throw new Error(`${id} fits ${people}`)
        expect(amount(month.total) * 12 - amount(year.total)).toBe(amount(year.saving))
      }
    }
  })

  it('tells when the team is larger than the plan allows', () => {
    expect(teamCost(planById('basic'), 6, 'year', 'en')).toEqual({ fits: false, seats: 5 })
    expect(teamCost(planById('business'), TEAM_SIZE.max, 'year', 'en').fits).toBe(true)
  })

  it('formats in the page language', () => {
    expect(teamCost(planById('business'), 10, 'year', 'de')).toMatchObject({
      total: "CHF 9'510",
      perPersonMonth: 'CHF 79.25',
    })
    expect(teamCost(planById('pro'), 1, 'year', 'nl')).toMatchObject({
      perPersonMonth: 'CHF 39,25',
    })
  })
})
