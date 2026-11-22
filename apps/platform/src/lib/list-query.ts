/**
 * The list search's query language: free text plus `field:value` terms (`status:paid`,
 * `name:"Acme AG"`). Terms map onto a list's own URL filters through each field's `get` and `set`,
 * so the URL stays the one source of truth for the search's chips and the Filters popover alike.
 */
import { todayIn } from '@/lib/timezone'

export type QueryFieldType = 'text' | 'enum' | 'tag' | 'date' | 'number'
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

/** A token's field and raw value when it names a known field (`status:`, `name:"Ac`), else null. */
export function splitTerm<P>(token: string, fields: readonly QueryField<P>[]) {
  const match = TERM.exec(token)
  const field = match?.[1] ? findField(fields, match[1]) : undefined
  return match && field ? { field, raw: match[2] ?? match[3] ?? '' } : null
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
  return term && value !== null ? { id: term.field.id, value } : null
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
  return `${term.id}:${/[\s"]/.test(term.value) ? `"${term.value.replaceAll('"', '')}"` : term.value}`
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

/** A term's chip text: the field's label and the value's label. */
export function termLabel<P>(fields: readonly QueryField<P>[], term: QueryTerm) {
  const field = fields.find((entry) => entry.id === term.id)
  const value = field?.values?.find((option) => option.value === term.value)?.label ?? term.value
  // An option labelled '' names nothing more than its field ("Credit notes of one invoice").
  return value ? `${field?.label ?? term.id}: ${value}` : (field?.label ?? term.id)
}
