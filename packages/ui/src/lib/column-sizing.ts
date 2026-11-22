/** A table column's width rules, in pixels: `flex` takes whatever room the others leave. */
export type SizedColumn = {
  id: string
  size: number
  min: number
  max: number
  flex?: boolean
}

/** Widths a person dragged, by column id. */
export type ColumnSizes = Readonly<Record<string, number>>

const clamp = (width: number, { min, max }: SizedColumn) =>
  Math.round(Math.min(Math.max(width, min), Math.max(min, max)))

const fixedWidth = (column: SizedColumn, sizes: ColumnSizes) =>
  clamp(sizes[column.id] ?? column.size, column)

/**
 * Every column's width: each at its dragged (or default) size within its range, the flexible one
 * taking the rest of `available` but never less than its min (the box scrolls then).
 */
export function layoutColumns(
  columns: readonly SizedColumn[],
  available: number,
  sizes: ColumnSizes,
): Record<string, number> {
  const widths: Record<string, number> = {}
  let used = 0
  for (const column of columns) {
    if (column.flex) continue
    widths[column.id] = fixedWidth(column, sizes)
    used += widths[column.id] ?? 0
  }
  const flex = columns.find((column) => column.flex)
  if (flex) widths[flex.id] = Math.max(flex.min, Math.round(available - used))
  return widths
}

/**
 * The width `id` may take when dragged to `width`: its own range, and no wider than leaves the
 * flexible column its min, so the table never runs past its box.
 */
export function resizeColumn(
  columns: readonly SizedColumn[],
  available: number,
  sizes: ColumnSizes,
  id: string,
  width: number,
): number {
  const column = columns.find((entry) => entry.id === id)
  if (!column) return width
  const flex = columns.find((entry) => entry.flex)
  if (!flex || column.flex) return clamp(width, column)
  const others = columns.reduce(
    (sum, entry) => (entry.flex || entry.id === id ? sum : sum + fixedWidth(entry, sizes)),
    0,
  )
  const room = Math.floor(available - others - flex.min)
  return clamp(Math.min(width, room), { ...column, max: Math.min(column.max, room) })
}

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
    else localStorage.setItem(key(table), JSON.stringify(sizes))
  } catch {
    // Private mode or a full quota: the widths last until the page reloads.
  }
}
