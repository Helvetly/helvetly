/**
 * The list search's query language: free text plus `field:value` terms (`status:paid`,
 * `name:"Acme AG"`). Terms map onto a list's own URL filters through each field's `get` and `set`,
 * so the URL stays the one source of truth for the search's chips and the Filters popover alike.
 */

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
}

/** The values that are one of `options`, typed as such (an enum field's terms). */
export const among = <T extends string>(options: readonly T[], values: readonly string[]) =>
  values.filter((value): value is T => (options as readonly string[]).includes(value))

/** `get` and `set` for a field kept as one value, where a new term replaces the old. */
export const single = <P>(
  read: (params: P) => string | null,
  write: (value: string | null) => Partial<P>,
) => ({
  get: (params: P) => {
    const value = read(params)
    return value ? [value] : []
  },
  set: (values: string[]) => write(values.at(-1) ?? null),
})

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
      return Number.isFinite(Number(value)) ? value : null
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
    (change, field) => ({
      ...change,
      ...field.set(
        [...new Set(terms.filter((term) => term.id === field.id).map((term) => term.value))],
        params,
      ),
    }),
    {},
  )
}

/** A term's chip text: the field's label and the value's label. */
export function termLabel<P>(fields: readonly QueryField<P>[], term: QueryTerm) {
  const field = fields.find((entry) => entry.id === term.id)
  const value = field?.values?.find((option) => option.value === term.value)?.label ?? term.value
  return `${field?.label ?? term.id}: ${value}`
}
