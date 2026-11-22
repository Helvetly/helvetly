import { useCallback, useMemo, useSyncExternalStore } from 'react'

// What a person set on a list table in this browser: widths, column order, rows per page.
// Never sent to the API; storage may be missing or full, so every access is guarded.

/** Widths a person dragged, by column id. */
export type ColumnSizes = Readonly<Record<string, number>>

const key = (table: string, what: 'columns' | 'order' | 'pageSize') =>
  `helvetly.table.${table}.${what}`

const read = (name: string) => {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Stores `value` (null removes it) and tells every table and menu reading it. */
function write(name: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(name)
    else localStorage.setItem(name, value)
  } catch {
    // Private mode or a full quota: the choice lasts until the page reloads, where it can.
  }
  for (const listener of listeners) listener()
}

/** The widths stored for `table`, only numbers for the given columns (anything else is dropped). */
export function readColumnSizes(table: string, columns: readonly string[]): ColumnSizes {
  try {
    const stored: unknown = JSON.parse(read(key(table, 'columns')) ?? 'null')
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
  write(
    key(table, 'columns'),
    Object.keys(sizes).length === 0
      ? null
      : JSON.stringify(
          Object.fromEntries(Object.entries(sizes).map(([id, width]) => [id, Math.round(width)])),
        ),
  )
}

/**
 * `ids` (the default order) in the `stored` order: ids no longer there are dropped, new ones go to
 * their default place, right after the column they follow by default.
 */
export function mergeOrder(stored: readonly string[], ids: readonly string[]): string[] {
  const order = [...new Set(stored)].filter((id) => ids.includes(id))
  ids.forEach((id, index) => {
    if (order.includes(id)) return
    const before = ids[index - 1]
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id)
  })
  return order
}

const parseOrder = (raw: string | null): string[] => {
  try {
    const stored: unknown = JSON.parse(raw ?? 'null')
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * The column order a person chose for `table`, merged into `ids` (the default order), and a setter;
 * `null` resets it. Tables and menus of the same id stay in step.
 */
export function useColumnOrder(table: string, ids: readonly string[]) {
  const name = key(table, 'order')
  const raw = useSyncExternalStore(
    subscribe,
    () => read(name),
    () => null,
  )
  const signature = ids.join('\n')
  const order = useMemo(
    () => mergeOrder(parseOrder(raw), signature ? signature.split('\n') : []),
    [raw, signature],
  )
  const setOrder = useCallback(
    (next: readonly string[] | null) => write(name, next === null ? null : JSON.stringify(next)),
    [name],
  )
  return { order, customised: raw !== null, setOrder }
}

export const PAGE_SIZES = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 50

/** The rows per page a person chose for `table` (one of `PAGE_SIZES`), and a setter. */
export function usePageSize(table: string) {
  const name = key(table, 'pageSize')
  const raw = useSyncExternalStore(
    subscribe,
    () => read(name),
    () => null,
  )
  const stored = Number(raw)
  const size = PAGE_SIZES.find((option) => option === stored) ?? DEFAULT_PAGE_SIZE
  const setSize = useCallback((next: number) => write(name, String(next)), [name])
  return [size, setSize] as const
}
