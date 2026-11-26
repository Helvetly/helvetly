import type { CashFlowPoint } from '@/lib/api'

export type Measure = 'income' | 'expenses' | 'net'

const value = (point: CashFlowPoint, measure: Measure) =>
  measure === 'net' ? point.income - point.expenses : point[measure]

/** The years with any movement, newest first. */
export function yearsWithData(points: CashFlowPoint[]): number[] {
  const years = new Set<number>()
  for (const point of points)
    if (point.income !== 0 || point.expenses !== 0) years.add(Number(point.date.slice(0, 4)))
  return [...years].toSorted((a, b) => b - a)
}

/**
 * One row per calendar month (0–11) with each year's figure under its year; a month the API has
 * not reached yet (the rest of this year) stays absent, so the year's line ends there.
 */
export function monthRows(points: CashFlowPoint[], measure: Measure) {
  const rows = Array.from({ length: 12 }, (_, month): Record<string, number> => ({ month }))
  for (const point of points) {
    const row = rows[Number(point.date.slice(5, 7)) - 1]
    if (row) row[point.date.slice(0, 4)] = value(point, measure)
  }
  return rows
}

/**
 * The year's total so far and its change against the same months of the year before; the change
 * is null when that year had nothing to compare with.
 */
export function yearToDate(points: CashFlowPoint[], measure: Measure, year: number) {
  const months = points.filter((point) => point.date.startsWith(`${year}-`))
  const lastMonth = months.at(-1)?.date.slice(5, 7) ?? '00'
  const sum = (from: CashFlowPoint[]) => from.reduce((total, p) => total + value(p, measure), 0)
  const total = sum(months)
  const before = sum(
    points.filter((p) => p.date.startsWith(`${year - 1}-`) && p.date.slice(5, 7) <= lastMonth),
  )
  return { total, change: before === 0 ? null : (total - before) / Math.abs(before) }
}
