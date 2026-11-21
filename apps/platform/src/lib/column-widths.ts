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

/** A column as laid out: its width from the page's own classes, and the range a person may size it in. */
export type SizedColumn = {
  id: string
  /** The width the page's classes give it in a table as wide as its box. */
  natural: number
  /** The least that keeps its header and badges whole. */
  min: number
  max: number
  /** Takes a dragged width; the others keep their natural one. */
  resizable: boolean
}

const clampWidth = (width: number, { min, max }: SizedColumn) =>
  Math.round(Math.min(Math.max(width, min), Math.max(min, max)))

/**
 * Every column's width in pixels: each at its dragged or natural width within its range, and
 * `flex` taking the rest of `available`, never less than its own range or its dragged width
 * (the table scrolls sideways then).
 */
export function solveWidths(
  columns: readonly SizedColumn[],
  flex: string,
  available: number,
  stored: ColumnWidths,
): Record<string, number> {
  const widths: Record<string, number> = {}
  let used = 0
  for (const column of columns) {
    if (column.id === flex) continue
    const width = clampWidth((column.resizable && stored[column.id]) || column.natural, column)
    widths[column.id] = width
    used += width
  }
  const room = columns.find((column) => column.id === flex)
  if (room)
    widths[flex] = Math.max(Math.round(available - used), clampWidth(stored[flex] ?? 0, room))
  return widths
}

/**
 * The stored widths once `id` is dragged to `width`. The flexible column gives the room it gives
 * up to the resizable columns after it (else before it), in proportion to their widths: the table
 * still fills its box and the edge follows the pointer.
 */
export function resizeWidths(
  columns: readonly SizedColumn[],
  flex: string,
  available: number,
  stored: ColumnWidths,
  id: string,
  width: number,
): ColumnWidths {
  const index = columns.findIndex((column) => column.id === id)
  const column = columns[index]
  if (!column) return stored
  const next = clampWidth(width, column)
  if (id !== flex) return { ...stored, [id]: next }
  const current = solveWidths(columns, flex, available, stored)
  const others = columns.reduce(
    (sum, entry) => sum + (entry.id === flex ? 0 : (current[entry.id] ?? 0)),
    0,
  )
  const room = Math.round(available - others)
  if (next >= room) return { ...stored, [flex]: next }
  const result: Record<string, number> = Object.fromEntries(
    Object.entries(stored).filter(([key]) => key !== flex),
  )
  const after = columns.slice(index + 1).filter((entry) => entry.resizable)
  const takers =
    after.length > 0 ? after : columns.slice(0, index).filter((entry) => entry.resizable)
  const spare = room - next
  const total = takers.reduce((sum, entry) => sum + (current[entry.id] ?? 0), 0)
  let given = 0
  takers.forEach((entry, place) => {
    const share =
      place === takers.length - 1
        ? spare - given
        : Math.round((spare * (current[entry.id] ?? 0)) / total)
    given += share
    result[entry.id] = clampWidth((current[entry.id] ?? 0) + share, entry)
  })
  return result
}
