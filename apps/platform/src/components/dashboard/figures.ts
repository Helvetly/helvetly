import { toCents } from '@/lib/invoices'

/** Which greeting fits the hour (0–23) on the person's clock. */
export function greetingKey(hour: number) {
  if (hour >= 5 && hour < 12) return 'goodMorningName' as const
  if (hour >= 12 && hour < 18) return 'goodAfternoonName' as const
  return 'goodEveningName' as const
}

/** The first word of a display name; empty for no name or an email address used as one. */
export function firstName(name: string | undefined) {
  const first = name?.trim().split(/\s+/)[0] ?? ''
  return first.includes('@') ? '' : first
}

/** This amount against the one before, as a share (0.12 = +12 %); null unless both have money. */
export function change(current: string, previous: string) {
  const now = toCents(current)
  const before = toCents(previous)
  if (now <= 0n || before <= 0n) return null
  return Number(((now - before) * 1000n) / before) / 1000
}

/** `part` as a share of `whole`, 0 to 1. */
export function share(part: string, whole: string) {
  const denominator = toCents(whole)
  if (denominator <= 0n) return 0
  return Math.min(Number((toCents(part) * 1000n) / denominator) / 1000, 1)
}

/**
 * Bar heights from 0 to 1 for mini bars. An empty month keeps a stub, so a mostly-empty series
 * still reads as months rather than as nothing; a month with money is never shorter than a third.
 */
export function barHeights(values: number[]) {
  const max = Math.max(0, ...values)
  return values.map((value) => (value <= 0 || max <= 0 ? 0.08 : Math.max(value / max, 0.33)))
}
