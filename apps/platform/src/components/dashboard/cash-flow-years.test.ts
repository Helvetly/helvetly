import { describe, expect, test } from 'vitest'

import { monthRows, yearToDate, yearsWithData } from './cash-flow-years'

const points = [
  { date: '2024-01-01', income: 0, expenses: 0 },
  { date: '2025-01-01', income: 100, expenses: 40 },
  { date: '2025-02-01', income: 50, expenses: 0 },
  { date: '2025-03-01', income: 999, expenses: 0 },
  { date: '2026-01-01', income: 120, expenses: 10 },
  { date: '2026-02-01', income: 90, expenses: 30 },
]

describe('yearsWithData', () => {
  test('skips years without movement, newest first', () =>
    expect(yearsWithData(points)).toEqual([2026, 2025]))
})

describe('monthRows', () => {
  test('puts each year under its month and leaves months not reached yet absent', () => {
    const rows = monthRows(points, 'net')
    expect(rows).toHaveLength(12)
    expect(rows[0]).toEqual({ month: 0, 2024: 0, 2025: 60, 2026: 110 })
    expect(rows[2]).toEqual({ month: 2, 2025: 999 })
    expect(rows[11]).toEqual({ month: 11 })
  })
})

describe('yearToDate', () => {
  test('compares the same months of the year before', () =>
    expect(yearToDate(points, 'income', 2026)).toEqual({ total: 210, change: 0.4 }))
  test('has no change without the year before', () =>
    expect(yearToDate(points, 'expenses', 2025)).toEqual({ total: 40, change: null }))
  test('measures a fall from a negative net against its size', () =>
    expect(
      yearToDate(
        [
          { date: '2025-01-01', income: 0, expenses: 100 },
          { date: '2026-01-01', income: 0, expenses: 50 },
        ],
        'net',
        2026,
      ).change,
    ).toBe(0.5))
})
