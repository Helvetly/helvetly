import { isClock, type Window } from '@/lib/scheduling-settings'

/** ISO weekdays, 1 = Monday. */
export const WEEK = [1, 2, 3, 4, 5, 6, 7] as const
export const WORKDAYS = [1, 2, 3, 4, 5] as const
export const DEFAULT_RANGE = { start: '09:00', end: '17:00' } as const

export type Range = { start: string; end: string }
export type RangeProblem = 'order' | 'overlap'

/** What a new host starts with: Monday to Friday, 09:00–17:00. */
export const defaultWeek = (): Window[] => WORKDAYS.map((day) => ({ day, ...DEFAULT_RANGE }))

/** The day's ranges (the week's own entries) in the order they were entered; editing never re-sorts them. */
export const rangesOf = (weekly: readonly Window[], day: number): Window[] =>
  weekly.filter((one) => one.day === day)

/** The week with day's ranges replaced; days stay in weekday order so the saved list reads naturally. */
export function setRanges(
  weekly: readonly Window[],
  day: number,
  ranges: readonly (Range | Window)[],
): Window[] {
  return WEEK.flatMap((one) =>
    one === day
      ? ranges.map((range) => ('day' in range && range.day === day ? range : { ...range, day }))
      : weekly.filter((window) => window.day === one),
  )
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
const clock = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
const LAST = 23 * 60 + 59

/** A further range after the day's latest: an hour after it ends, for an hour; null when the day is full. */
export function nextRange(ranges: readonly Range[]): Range | null {
  if (ranges.length === 0) return { ...DEFAULT_RANGE }
  const latest = Math.max(...ranges.map((range) => (isClock(range.end) ? minutes(range.end) : 0)))
  const start = Math.min(latest + 60, LAST - 60)
  if (start <= latest) return null
  return { start: clock(start), end: clock(Math.min(start + 60, LAST)) }
}

/** Copies from's ranges onto each of days (turning them on), leaving from itself as it is. */
export function copyDay(
  weekly: readonly Window[],
  from: number,
  days: readonly number[],
): Window[] {
  const ranges = rangesOf(weekly, from)
  return days.reduce<Window[]>(
    (week, day) => (day === from ? week : setRanges(week, day, ranges)),
    [...weekly],
  )
}

/**
 * The problem of each range of the day, by its index: one that does not end after it starts, or one that overlaps
 * an earlier range of the same day.
 */
export function rangeProblems(ranges: readonly Range[]): Map<number, RangeProblem> {
  const problems = new Map<number, RangeProblem>()
  ranges.forEach((range, i) => {
    if (!isClock(range.start) || !isClock(range.end) || range.start >= range.end)
      problems.set(i, 'order')
  })
  const ordered = ranges.map((_, i) => !problems.has(i))
  ranges.forEach((range, i) => {
    const clash =
      ordered[i] &&
      ranges.some(
        (other, j) => j !== i && ordered[j] && other.start < range.end && range.start < other.end,
      )
    if (clash) problems.set(i, 'overlap')
  })
  return problems
}

/** Every 15 minutes of the day, plus value when it is off that grid, so a saved 10:10 still shows. */
export function clockOptions(value: string): string[] {
  const all = Array.from({ length: 96 }, (_, i) => clock(i * 15))
  if (isClock(value) && !all.includes(value)) all.push(value)
  if (!all.includes('23:59')) all.push('23:59')
  return all.toSorted()
}
