/** Column widths a person dragged, in pixels, by column id: a per-browser choice. */
export type ColumnWidths = Readonly<Record<string, number>>

export const columnWidthsKey = (table: string) => `helvetly.table.${table}.columns`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The stored widths of a table, or none: the entry names the column set it was saved for, so a
 * table whose columns changed ignores it rather than sizing the wrong columns.
 */
export function readColumnWidths(table: string, columns: readonly string[]): ColumnWidths {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(columnWidthsKey(table)) ?? 'null')
    if (!isRecord(stored) || stored.columns !== columns.join(',') || !isRecord(stored.widths))
      return {}
    return Object.fromEntries(
      Object.entries(stored.widths).filter(
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

export function writeColumnWidths(table: string, columns: readonly string[], widths: ColumnWidths) {
  try {
    if (Object.keys(widths).length === 0) localStorage.removeItem(columnWidthsKey(table))
    else
      localStorage.setItem(
        columnWidthsKey(table),
        JSON.stringify({ columns: columns.join(','), widths }),
      )
  } catch {}
}
