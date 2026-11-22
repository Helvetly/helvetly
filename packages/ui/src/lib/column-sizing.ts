/** Widths a person dragged, by column id. */
export type ColumnSizes = Readonly<Record<string, number>>

const key = (table: string) => `helvetly.table.${table}.columns`

/** The widths stored for `table`, only numbers for the given columns (anything else is dropped). */
export function readColumnSizes(table: string, columns: readonly string[]): ColumnSizes {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key(table)) ?? 'null')
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, number] =>
          columns.includes(entry[0]) &&
          typeof entry[1] === 'number' &&
          Number.isFinite(entry[1]) &&
          entry[1] > 0,
      ),
    )
  } catch {
    return {}
  }
}

export function writeColumnSizes(table: string, sizes: ColumnSizes) {
  try {
    if (Object.keys(sizes).length === 0) localStorage.removeItem(key(table))
    else
      localStorage.setItem(
        key(table),
        JSON.stringify(
          Object.fromEntries(Object.entries(sizes).map(([id, width]) => [id, Math.round(width)])),
        ),
      )
  } catch {
    // Private mode or a full quota: the widths last until the page reloads.
  }
}
