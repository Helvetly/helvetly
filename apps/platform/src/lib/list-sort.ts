// Sorting a list the API answers whole: the column and direction live in the URL as `?sort=field`
// (ascending) or `?sort=-field` (descending), as on the server-sorted lists (clients, invoices).

export type Sort<Field extends string> = { field: Field; desc: boolean }

/** The sort in `value` when it names one of `fields`, else `fallback`. */
export function parseSort<Field extends string>(
  value: string | null,
  fields: readonly Field[],
  fallback: Sort<Field>,
): Sort<Field> {
  const desc = value?.startsWith('-') ?? false
  const field = fields.find((entry) => entry === value?.replace(/^-/, ''))
  return field ? { field, desc } : fallback
}

/** The `sort` URL value, or null for the list's own order (which keeps the URL clean). */
export function sortParam<Field extends string>(sort: Sort<Field>, fallback: Sort<Field>) {
  if (sort.field === fallback.field && sort.desc === fallback.desc) return null
  return `${sort.desc ? '-' : ''}${sort.field}`
}

/** A click on a column's header: the other direction on the sorted column, else `descFirst`. */
export function nextSort<Field extends string>(
  current: Sort<Field>,
  field: Field,
  descFirst: boolean,
): Sort<Field> {
  return { field, desc: current.field === field ? !current.desc : descFirst }
}

export type SortValue = string | number | null | undefined

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * `rows` ordered by `value`: text as people read it (case-insensitive, "10" after "9"), numbers by
 * size; empty values last either way. Equal rows keep their order (the API's).
 */
export function sortRows<Row>(
  rows: readonly Row[],
  value: (row: Row) => SortValue,
  desc: boolean,
): Row[] {
  const sign = desc ? -1 : 1
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .toSorted((a, b) => {
      const empty = Number(a.key == null || a.key === '') - Number(b.key == null || b.key === '')
      if (empty) return empty
      const order =
        typeof a.key === 'number' && typeof b.key === 'number'
          ? a.key - b.key
          : collator.compare(String(a.key ?? ''), String(b.key ?? ''))
      return order * sign || a.index - b.index
    })
    .map((entry) => entry.row)
}
