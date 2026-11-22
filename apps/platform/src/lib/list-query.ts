/**
 * The list search's query language: free text plus `field:value` terms (`status:paid`,
 * `name:"Acme AG"`). Terms map onto a list's own URL filters through each field's `get` and `set`,
 * so the URL stays the one source of truth for the search's chips and the Filters popover alike.
 */
import type { Tone } from '@helvetly/ui/components/badge'

import { translate } from '@/lib/i18n'
import { todayIn } from '@/lib/timezone'

export type QueryFieldType = 'text' | 'enum' | 'tag' | 'date' | 'number'
/** What a field filters by, for its chip's tint: one colour per kind, the same on every list. */
export type QueryKind = 'status' | 'tag' | 'location' | 'date' | 'amount' | 'text'
export type QueryOption = { value: string; label: string }

export type QueryField<P> = {
  /** What one types before the colon. */
  id: string
  label: string
  type: QueryFieldType
  /** Known values, suggested after the colon: an enum's choices (required for enums), a list's tags. */
  values?: readonly QueryOption[]
  /** This field's values in the list's params. */
  get: (params: P) => readonly string[]
  /** The params change that makes `values` this field's values. */
  set: (values: string[], params: P) => Partial<P>
  /**
   * The Filters popover's control for this field, named by its placeholder ("Any unit…"); fields without one
   * (text the search covers, a view tab) have no control there.
   */
  placeholder?: string
  /** A range's other end (`from` with `until: 'to'`, `min` with `until: 'max'`): one popover control for both. */
  until?: string
  /** Holds one value: a new term replaces the old one. */
  single?: boolean
  /** Its chip's tint, when not the type's own (a country is a `location`, a "since" enum a `date`). */
  kind?: QueryKind
  /** Each value's status tone (`STATUS_TONES`): a chip whose values share one is painted with it. */
  tones?: Readonly<Record<string, Tone>>
  /** Takes `-field:value`, kept as the value `!value`: everything but it. */
  negatable?: boolean
}

const KIND_OF_TYPE: Record<QueryFieldType, QueryKind> = {
  enum: 'status',
  tag: 'tag',
  date: 'date',
  number: 'amount',
  text: 'text',
}

const KIND_TONES: Record<QueryKind, Tone> = {
  status: 'violet',
  tag: 'blue',
  location: 'green',
  date: 'amber',
  amount: 'neutral',
  text: 'neutral',
}

/** A chip's tone: the values' shared status tone, else its field kind's. */
export function chipTone<P>(field: QueryField<P>, values: readonly string[]): Tone {
  const tones = new Set(values.map((value) => field.tones?.[value]))
  const [shared] = tones
  return tones.size === 1 && shared ? shared : KIND_TONES[field.kind ?? KIND_OF_TYPE[field.type]]
}

/** The values that are one of `options`, typed as such (an enum field's terms). */
export const among = <T extends string>(options: readonly T[], values: readonly string[]) =>
  values.filter((value): value is T => (options as readonly string[]).includes(value))

/** `get` and `set` for a field kept as one value, where a new term replaces the old. */
export const oneValue = <P>(
  read: (params: P) => string | null,
  write: (value: string | null) => Partial<P>,
) => ({
  get: (params: P) => {
    const value = read(params)
    return value ? [value] : []
  },
  set: (values: string[]) => write(values.at(-1) ?? null),
  single: true,
})

/**
 * `get` and `set` for a field a control beside the search already shows (a view tab, a select): it
 * gets no chip, and a typed term sets the control.
 */
export const shownElsewhere = <P>(write: (value: string) => Partial<P>) => ({
  get: (): string[] => [],
  set: (values: string[]): Partial<P> => {
    const value = values.at(-1)
    return value === undefined ? {} : write(value)
  },
})

export const SINCE_PRESETS = ['7d', '30d', 'year'] as const
export type SincePreset = (typeof SINCE_PRESETS)[number]

export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** The first day a "since" preset covers, counted back from today (YYYY-MM-DD) in the workspace's time zone. */
export function sinceDate(preset: SincePreset, today = todayIn()) {
  if (preset === 'year') return `${today.slice(0, 4)}-01-01`
  const from = new Date(`${today}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - (preset === '7d' ? 6 : 29))
  return from.toISOString().slice(0, 10)
}

/** One field term, shaped like TanStack Table's `ColumnFilter`. */
export type QueryTerm = { id: string; value: string }

/** Splits on whitespace outside double quotes. */
export function tokenize(input: string) {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (const char of input) {
    if (char === '"') quoted = !quoted
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
    } else current += char
  }
  if (current) tokens.push(current)
  return tokens
}

/** Whether the input ends inside an unclosed quote. */
export const inQuote = (input: string) => (input.match(/"/g)?.length ?? 0) % 2 === 1

const TERM = /^([^\s:"]+):(?:"([^"]*)"?|([^"]*))$/

export function findField<P>(fields: readonly QueryField<P>[], name: string) {
  const lower = name.toLowerCase()
  return fields.find(
    (field) => field.id.toLowerCase() === lower || field.label.toLowerCase() === lower,
  )
}

/**
 * A token's field and raw value when it names a known field (`status:`, `name:"Ac`), else null; `not` for a
 * negatable field's `-field:`.
 */
export function splitTerm<P>(token: string, fields: readonly QueryField<P>[]) {
  const negated = token.startsWith('-')
  const match = TERM.exec(negated ? token.slice(1) : token)
  const field = match?.[1] ? findField(fields, match[1]) : undefined
  if (!match || !field || (negated && !field.negatable)) return null
  return { field, raw: match[2] ?? match[3] ?? '', not: negated }
}

/** An amount as the API takes it: never negative, at most two decimals. */
export const isAmount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value)

/** An amount from the page URL, or null when it is missing or malformed. */
export const amountParam = (value: string | null) =>
  value !== null && isAmount(value) ? value : null

/** The value a field stores for what was typed, or null when the field cannot take it. */
export function resolveValue<P>(field: QueryField<P>, raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const lower = value.toLowerCase()
  const known = field.values?.find(
    (option) => option.value.toLowerCase() === lower || option.label.toLowerCase() === lower,
  )?.value
  switch (field.type) {
    case 'enum':
      return known ?? null
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null
    case 'number':
      return isAmount(value) ? value : null
    default:
      return known ?? value
  }
}

export function parseTerm<P>(token: string, fields: readonly QueryField<P>[]): QueryTerm | null {
  const term = splitTerm(token, fields)
  const value = term && resolveValue(term.field, term.raw)
  return term && value !== null
    ? { id: term.field.id, value: term.not ? `!${value}` : value }
    : null
}

/** Terms for known fields with valid values; every other token (unknown fields too) is free text. */
export function parseQuery<P>(input: string, fields: readonly QueryField<P>[]) {
  const terms: QueryTerm[] = []
  const text: string[] = []
  for (const token of tokenize(input)) {
    const term = parseTerm(token, fields)
    if (term) terms.push(term)
    else text.push(token)
  }
  return { terms, text: text.join(' ') }
}

/** A term as typed again, for editing a chip. */
export function formatTerm(term: QueryTerm) {
  const not = term.value.startsWith('!')
  const value = not ? term.value.slice(1) : term.value
  return `${not ? '-' : ''}${term.id}:${/[\s"]/.test(value) ? `"${value.replaceAll('"', '')}"` : value}`
}

export const termsOf = <P>(fields: readonly QueryField<P>[], params: P): QueryTerm[] =>
  fields.flatMap((field) => field.get(params).map((value) => ({ id: field.id, value })))

/** The params change that makes `terms` the list's field filters. */
export function changeFor<P>(fields: readonly QueryField<P>[], terms: QueryTerm[], params: P) {
  return fields.reduce<Partial<P>>(
    (change, field) =>
      Object.assign(
        change,
        field.set(
          [...new Set(terms.filter((term) => term.id === field.id).map((term) => term.value))],
          params,
        ),
      ),
    {},
  )
}

/** A value's label: its option's, read "not …" when negated. */
export function valueLabel<P>(field: QueryField<P> | undefined, value: string) {
  const not = value.startsWith('!')
  const own = not ? value.slice(1) : value
  const label = field?.values?.find((option) => option.value === own)?.label ?? own
  return not ? translate('filterNot', { value: label }) : label
}

/** A term's text: the field's label and the value's label. */
export function termLabel<P>(fields: readonly QueryField<P>[], term: QueryTerm) {
  const field = fields.find((entry) => entry.id === term.id)
  const value = valueLabel(field, term.value)
  // An option labelled '' names nothing more than its field ("Credit notes of one invoice").
  return value ? `${field?.label ?? term.id}: ${value}` : (field?.label ?? term.id)
}

/** How many values a chip names before "+N"; the rest are in its tooltip. */
const SHOWN_VALUES = 2

/**
 * One chip's values, all of one field: "A", "A or B", or "A, B +3" with `rest` the count left out, so a
 * field typed many times stays one short chip.
 */
export function chipValues<P>(field: QueryField<P> | undefined, values: readonly string[]) {
  const labels = values.map((value) => valueLabel(field, value)).filter(Boolean)
  if (labels.length <= SHOWN_VALUES)
    return {
      text: labels.length ? labels.reduce((a, b) => translate('filterOr', { a, b })) : '',
      rest: 0,
      labels,
    }
  return {
    text: labels.slice(0, SHOWN_VALUES).join(', '),
    rest: labels.length - SHOWN_VALUES,
    labels,
  }
}
