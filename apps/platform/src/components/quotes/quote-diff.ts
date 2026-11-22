// What changed between a sent revision of a quote and the quote as it is now: lines added, removed or changed,
// totals, dates and texts. Pure, so the History tab only draws it.
import type { Line } from '@/lib/invoices'
import type { Quote } from '@/lib/quotes'

/** The parts of a line a client reads: what, how much, at what price and discount, under which VAT. */
export const LINE_FIELDS = [
  'description',
  'quantity',
  'unit',
  'unit_price',
  'discount_percent',
  'vat',
] as const
export type LineField = (typeof LINE_FIELDS)[number]

export type LineDiff =
  | { kind: 'same'; line: Line }
  | { kind: 'added'; line: Line }
  | { kind: 'removed'; line: Line }
  | { kind: 'changed'; before: Line; line: Line; fields: LineField[] }

export const QUOTE_FIELDS = [
  'issue_date',
  'valid_until',
  'currency',
  'vat_mode',
  'discount_percent',
  'reference',
  'intro',
  'footer',
] as const
export const TOTAL_FIELDS = ['subtotal', 'discount_amount', 'vat_total', 'payable_total'] as const

export type FieldChange<K extends string> = { field: K; before: string; after: string }

export type QuoteDiff = {
  lines: LineDiff[]
  fields: FieldChange<(typeof QUOTE_FIELDS)[number]>[]
  totals: FieldChange<(typeof TOTAL_FIELDS)[number]>[]
}

/** Decimals compare by value ("8" = "8.00"), text by its trimmed content. */
const sameValue = (a: string | null, b: string | null) => {
  const x = (a ?? '').trim()
  const y = (b ?? '').trim()
  if (x === y) return true
  return x !== '' && y !== '' && !Number.isNaN(Number(x)) && Number(x) === Number(y)
}

const lineValue = (line: Line, field: LineField) =>
  field === 'vat' ? `${line.vat_category} ${line.vat_rate}` : (line[field] ?? '')

function lineFields(before: Line, after: Line) {
  return LINE_FIELDS.filter((field) => {
    if (field === 'vat')
      return (
        before.vat_category !== after.vat_category || !sameValue(before.vat_rate, after.vat_rate)
      )
    return !sameValue(lineValue(before, field), lineValue(after, field))
  })
}

/**
 * Pairs the lines of two revisions: the same line id first, then the same description, then the same position
 * (an edited description); what is left was added or removed. Removed lines sit where they were.
 */
export function diffLines(before: Line[], after: Line[]): LineDiff[] {
  const pairs = new Map<Line, Line>()
  const free = new Set(before)
  const match = (test: (old: Line, line: Line) => boolean) => {
    for (const line of after) {
      if ([...pairs.values()].includes(line)) continue
      const old = [...free].find((candidate) => test(candidate, line))
      if (old) {
        pairs.set(old, line)
        free.delete(old)
      }
    }
  }
  match((old, line) => old.id === line.id)
  match((old, line) => old.description.trim() === line.description.trim())
  match((old, line) => old.position === line.position)
  const previous = new Map([...pairs].map(([old, line]) => [line, old]))
  const rows: { at: number; diff: LineDiff }[] = after.map((line) => {
    const old = previous.get(line)
    if (!old) return { at: line.position, diff: { kind: 'added', line } }
    const fields = lineFields(old, line)
    return {
      at: line.position,
      diff: fields.length ? { kind: 'changed', before: old, line, fields } : { kind: 'same', line },
    }
  })
  for (const old of free)
    rows.push({ at: old.position - 0.5, diff: { kind: 'removed', line: old } })
  return rows.toSorted((a, b) => a.at - b.at).map((row) => row.diff)
}

function changes<K extends string>(
  keys: readonly K[],
  before: Record<K, string | null>,
  after: Record<K, string | null>,
): FieldChange<K>[] {
  return keys
    .filter((key) => !sameValue(before[key], after[key]))
    .map((key) => ({ field: key, before: before[key] ?? '', after: after[key] ?? '' }))
}

/** What changed from the revision `before` (a sent snapshot) to `after` (the quote now). */
export function diffQuotes(before: Quote, after: Quote): QuoteDiff {
  return {
    lines: diffLines(before.lines, after.lines),
    fields: changes(QUOTE_FIELDS, before, after),
    totals: changes(TOTAL_FIELDS, before, after),
  }
}

/** Nothing a client would notice changed. */
export const isUnchanged = (diff: QuoteDiff) =>
  diff.fields.length === 0 &&
  diff.totals.length === 0 &&
  diff.lines.every((line) => line.kind === 'same')
