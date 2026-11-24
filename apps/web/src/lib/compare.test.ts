import type { Locale } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import { cellOf, compareIn, MAX_CELL_LENGTH, NOT_COMPARED, ROW_KEYS } from './compare'
import { plansIn } from './plans'
import { TEAM_SIZES, TIERED_PLANS, yearlyFor } from './team-pricing'

const LANGUAGES = ['en', 'de', 'fr', 'it', 'nl', 'cs', 'sv'] as const satisfies readonly Locale[]

describe.each(LANGUAGES)('comparisons in %s', (language) => {
  const { COMPETITORS, OURS, HELVETLY_YEARLY, ROW_GROUPS } = compareIn(language)
  const sides = [{ name: 'Helvetly', rows: OURS }, ...COMPETITORS]

  it('show every row once, in a section', () => {
    expect(ROW_GROUPS.flatMap((g) => g.rows.map((r) => r.key)).toSorted()).toEqual(
      [...ROW_KEYS].toSorted(),
    )
  })

  it.each(sides.map((s) => [s.name, s] as const))(
    '%s has a value or an explicit unknown for every row, each a few words',
    (_name, side) => {
      expect(Object.keys(side.rows).toSorted()).toEqual([...ROW_KEYS].toSorted())
      const cells = ROW_KEYS.map((key) => ({ key, ...cellOf(side.rows[key]) }))
      const kinds = new Set(
        cells.map(({ value }) =>
          value === NOT_COMPARED ? 'unchecked' : value === null ? 'null' : typeof value,
        ),
      )
      expect(
        [...kinds].filter((kind) => !['string', 'boolean', 'null', 'unchecked'].includes(kind)),
      ).toEqual([])
      const texts = cells.filter((c) => typeof c.value === 'string')
      expect(texts.filter((c) => String(c.value).trim() === '')).toEqual([])
      expect(texts.filter((c) => String(c.value).length > MAX_CELL_LENGTH)).toEqual([])
      expect(cells.filter((c) => c.note !== undefined && c.note.trim() === '')).toEqual([])
    },
  )

  it.each(COMPETITORS.map((c) => [c.slug, c] as const))(
    '%s has up to four reasons to switch and a dated price per team size',
    (_slug, them) => {
      expect(them.oursIf.length).toBeGreaterThan(0)
      expect(them.oursIf.length).toBeLessThanOrEqual(4)
      expect(them.yearly.prices).toHaveLength(TEAM_SIZES.length)
      expect(them.yearly.note).not.toBe('')
      expect(them.pricesChecked).toMatch(/2026/)
      expect(new URL(them.priceUrl).protocol).toBe('https:')
    },
  )

  it('quote Helvetly’s prices from the team pricing module', () => {
    const { count } = plansIn(language)
    for (const { id, prices } of HELVETLY_YEARLY)
      expect(prices).toEqual(TEAM_SIZES.map((n) => `CHF ${count(yearlyFor(id, n))}`))
    expect(String(cellOf(OURS.paidFrom).value)).toContain(`CHF ${TIERED_PLANS.basic.monthly}`)
    const note = cellOf(OURS.paidFrom).note ?? ''
    for (const plan of Object.values(TIERED_PLANS)) expect(note).toContain(`CHF ${plan.monthly}`)
  })
})

it('prices a year for 1, 3 and 5 people as the offer does', () => {
  const { HELVETLY_YEARLY } = compareIn('en')
  expect(Object.fromEntries(HELVETLY_YEARLY.map((p) => [p.id, p.prices]))).toEqual({
    basic: ['CHF 183', 'CHF 375', 'CHF 567'],
    pro: ['CHF 471', 'CHF 615', 'CHF 903'],
    business: ['CHF 1’431', 'CHF 1’431', 'CHF 1’431'],
  })
})
