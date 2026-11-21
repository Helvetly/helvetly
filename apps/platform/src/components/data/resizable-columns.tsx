'use client'
import { Button } from '@helvetly/ui/components/button'
import { Separator } from '@helvetly/ui/components/separator'
import { cn } from '@helvetly/ui/lib/utils'
import { RotateCcw } from 'lucide-react'
import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type PointerEvent,
} from 'react'

import {
  readColumnWidths,
  resizeWidths,
  solveWidths,
  writeColumnWidths,
  type ColumnWidths,
  type SizedColumn,
} from '@/lib/column-widths'
import { translate } from '@/lib/i18n'

/** Phones keep the layout they have: dragging a column needs room. */
const WIDE = '(min-width: 768px)'
const subscribe = (change: () => void) => {
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}
const useWide = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  )

const MAX = 640
/** The flexible column (the client, the name) keeps room to read its text. */
const FLEX_MIN = 160
/** The flexible column may grow past the page: the table scrolls. */
const FLEX_MAX = 1600
const STEP = 16

const heads = (table: HTMLTableElement) => [...(table.tHead?.rows[0]?.cells ?? [])]
const columnId = (head: HTMLTableCellElement, index: number) => head.dataset.column ?? `:${index}`
const padding = (element: Element) => {
  const style = getComputedStyle(element)
  return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
}

/** Back to the widths the page's classes give: the table as wide as its box. */
function unsize(table: HTMLTableElement) {
  table.style.width = ''
  for (const head of heads(table)) head.style.width = ''
}

/** A badge's own width: it may be squeezed (`max-w-full`), its content may not. */
const badgeWidth = (badge: HTMLElement) => badge.scrollWidth + badge.offsetWidth - badge.clientWidth

/**
 * The least a column takes, read with every column as narrow as it goes: its header (label, sort
 * arrow) on one line, and every badge in its cells whole with what sits before it (an avatar).
 * Text truncates, so it asks for nothing.
 */
function minimum(head: HTMLTableCellElement, index: number, table: HTMLTableElement) {
  const label = document.createRange()
  label.selectNodeContents(head)
  const handle = head.querySelector(':scope > [data-column-resizer]')
  if (handle) label.setEndBefore(handle)
  let least = label.getBoundingClientRect().width + padding(head)
  for (const row of table.tBodies[0]?.rows ?? []) {
    const cell = row.cells[index]
    if (!cell) continue
    const left = cell.getBoundingClientRect().left
    const right = parseFloat(getComputedStyle(cell).paddingRight)
    for (const badge of cell.querySelectorAll<HTMLElement>('[data-slot=badge]'))
      least = Math.max(least, badge.getBoundingClientRect().left - left + badgeWidth(badge) + right)
  }
  return Math.ceil(least) + 1
}

/** The table's shown columns as the page lays them out, with the range each may be sized in. */
function measure(table: HTMLTableElement, flex: string, resizable: readonly string[]) {
  unsize(table)
  const shown = heads(table).flatMap((head, index) =>
    head.getClientRects().length === 0
      ? []
      : [{ head, index, natural: Math.round(head.getBoundingClientRect().width) }],
  )
  table.style.width = '0px'
  for (const { head } of shown) head.style.width = '0px'
  const columns = shown.map(({ head, index, natural }): SizedColumn => {
    const id = columnId(head, index)
    const min = minimum(head, index, table)
    return {
      id,
      natural,
      min: id === flex ? Math.max(min, FLEX_MIN) : min,
      max: id === flex ? FLEX_MAX : resizable.includes(id) ? MAX : Number.POSITIVE_INFINITY,
      resizable: resizable.includes(id),
    }
  })
  unsize(table)
  return columns
}

type Sizing = { columns: SizedColumn[]; available: number }

/** Gives every shown column its width in pixels, the table their sum (at least its box). */
function apply(table: HTMLTableElement, flex: string, sizing: Sizing, stored: ColumnWidths) {
  const widths = solveWidths(sizing.columns, flex, sizing.available, stored)
  let total = 0
  heads(table).forEach((head, index) => {
    const width = widths[columnId(head, index)]
    head.style.width = width === undefined ? '' : `${width}px`
    total += width ?? 0
  })
  table.style.width = `${Math.max(total, sizing.available)}px`
}

export type ResizableColumns = ReturnType<typeof useResizableColumns>

/**
 * Column widths a person drags, kept per table in this browser. Every column keeps at least what
 * its header and badges need; `flex` (the client, the name) takes the rest of the row, and the
 * table scrolls sideways when the columns no longer fit.
 */
export function useResizableColumns(
  table: string,
  columns: readonly string[],
  { flex }: { flex: string },
) {
  const enabled = useWide()
  const id = useId()
  const key = columns.join(',')
  const [widths, setWidths] = useState<ColumnWidths>(() => readColumnWidths(table, columns))
  const element = useRef<HTMLTableElement>(null)
  const sizing = useRef<Sizing>(undefined)
  /** Widths shown while dragging: a relayout meanwhile (a scrollbar appearing) keeps them. */
  const pending = useRef<ColumnWidths>(undefined)

  // A callback ref with a cleanup: it lays the table out again for new widths or columns, when
  // its box changes size and when its rows or headers change (badges, a sort arrow).
  const fitTable = useCallback(
    (node: HTMLTableElement | null) => {
      element.current = node
      if (!node || !enabled) return
      const scroller = node.parentElement
      if (!scroller) return
      const layout = () => {
        if (!node.offsetParent) return
        sizing.current = {
          columns: measure(node, flex, key.split(',')),
          available: scroller.clientWidth,
        }
        apply(node, flex, sizing.current, pending.current ?? widths)
      }
      layout()
      // A web font arriving changes what the headers and badges need.
      const gone = new AbortController()
      void document.fonts.ready.then(() => gone.signal.aborted || layout())
      const resize = new ResizeObserver(layout)
      resize.observe(scroller)
      const content = new MutationObserver(layout)
      content.observe(node, { childList: true, subtree: true, characterData: true })
      return () => {
        gone.abort()
        resize.disconnect()
        content.disconnect()
        unsize(node)
      }
    },
    [enabled, flex, key, widths],
  )

  const commit = (next: ColumnWidths) => {
    pending.current = undefined
    setWidths(next)
    writeColumnWidths(table, columns, next)
  }

  return {
    enabled,
    fitTable,
    customised: Object.keys(widths).length > 0,
    /** A column's range, as last laid out. */
    range: (column: string) => sizing.current?.columns.find((entry) => entry.id === column),
    /** The stored widths once `column` is `width` wide, kept to its range. */
    resized: (column: string, width: number, from: ColumnWidths = widths) =>
      sizing.current
        ? resizeWidths(sizing.current.columns, flex, sizing.current.available, from, column, width)
        : from,
    widths,
    commit,
    /** Shows widths while dragging, before they are committed. */
    preview: (next: ColumnWidths | undefined) => {
      pending.current = next
      if (element.current && sizing.current)
        apply(element.current, flex, sizing.current, next ?? widths)
    },
    reset: (column?: string) =>
      commit(
        column === undefined
          ? {}
          : Object.fromEntries(Object.entries(widths).filter(([entry]) => entry !== column)),
      ),
    /** The hidden label of a column, its header's name: not the handle's value with it. */
    labelId: (column: string) => `${id}${column}`,
    /** Props for a column's `<th>`: its name and where the layout finds it. */
    head: (column: string) => ({
      'data-column': column,
      'aria-labelledby': enabled && columns.includes(column) ? `${id}${column}` : undefined,
    }),
  }
}

/** A resizable column's `<th>`, its label (or `children`) and the handle. */
export function ResizableHead({
  columns,
  column,
  label,
  children = label,
  ...props
}: ComponentProps<'th'> & { columns: ResizableColumns; column: string; label: string }) {
  return (
    <th {...props} {...columns.head(column)}>
      {children}
      <ColumnResizer columns={columns} column={column} label={label} />
    </th>
  )
}

/** The table, in a box that scrolls sideways once the columns are wider than the page. */
export function ResizableTable({
  columns: { enabled, fitTable },
  ...props
}: ComponentProps<'table'> & { columns: ResizableColumns }) {
  return (
    <div className={cn(enabled && 'overflow-x-auto')}>
      <table ref={fitTable} {...props} />
    </div>
  )
}

const KEYS: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
}

const widthOf = (element: Element) =>
  Math.round(element.closest('th')?.getBoundingClientRect().width ?? 0)

/**
 * The handle on a header cell's right edge: drag it, or use the arrow keys once focused (a range
 * input, like Heidi's edge); double-click for the column's own width again. Shown on hover.
 */
export function ColumnResizer({
  columns,
  column,
  label,
}: {
  columns: ResizableColumns
  column: string
  label: string
}) {
  const [shown, setShown] = useState<{ width: number; min: number; max: number }>()
  const [dragging, setDragging] = useState(false)
  if (!columns.enabled) return null

  /** The handle's value and range as laid out now: a column stops at its range. */
  const sync = (handle: HTMLInputElement) => {
    const range = columns.range(column)
    const min = range?.min ?? 0
    setShown({ width: widthOf(handle), min, max: Math.max(min, range?.max ?? min) })
  }
  const settle = (handle: HTMLInputElement) => requestAnimationFrame(() => sync(handle))
  const resizeTo = (handle: HTMLInputElement, next: number) => {
    columns.commit(columns.resized(column, next))
    settle(handle)
  }

  const onPointerDown = (event: PointerEvent<HTMLInputElement>) => {
    const handle = event.currentTarget
    if (event.button !== 0 || !handle.closest('th')) return
    // Not the range's own jump to where it was pressed: the edge follows the pointer.
    event.preventDefault()
    handle.focus({ preventScroll: true })
    const x = event.clientX
    const start = widthOf(handle)
    const from = columns.widths
    let last = from
    sync(handle)
    setDragging(true)
    const follow = (move: globalThis.PointerEvent) => {
      last = columns.resized(column, start + move.clientX - x, from)
      columns.preview(last)
      sync(handle)
    }
    const end = () => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDragging(false)
      if (last !== from) columns.commit(last)
      else columns.preview(undefined)
      settle(handle)
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    <span
      data-column-resizer
      data-dragging={dragging || undefined}
      className="group/resizer absolute inset-y-0 -right-1.5 z-10 w-3"
    >
      <span id={columns.labelId(column)} hidden>
        {label}
      </span>
      <input
        type="range"
        aria-label={translate('resizeColumn', { column: label })}
        min={shown?.min ?? 0}
        max={Number.isFinite(shown?.max) ? shown?.max : shown?.min}
        step={1}
        value={shown?.width ?? 0}
        onChange={(event) => resizeTo(event.currentTarget, Number(event.target.value))}
        onFocus={(event) => sync(event.currentTarget)}
        onKeyDown={(event) => {
          const direction = KEYS[event.key]
          if (!direction) return
          // Our own steps from the column's width now (Shift: four), not the range's.
          event.preventDefault()
          resizeTo(
            event.currentTarget,
            widthOf(event.currentTarget) + direction * (event.shiftKey ? STEP * 4 : STEP),
          )
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={(event) => {
          columns.reset(column)
          settle(event.currentTarget)
        }}
        className="peer absolute inset-0 m-0 h-full w-full cursor-col-resize touch-none appearance-none opacity-0"
      />
      <span className="pointer-events-none absolute inset-y-2.5 left-1/2 w-px -translate-x-1/2 bg-border opacity-0 transition-opacity group-hover/th:opacity-100 group-data-dragging/resizer:bg-ring group-data-dragging/resizer:opacity-100 peer-focus-visible:bg-ring peer-focus-visible:opacity-100" />
    </span>
  )
}

/** "Reset column widths" for a table's Customize menu, enabled once a column was resized. */
export function ResetColumnWidths({ columns }: { columns: ResizableColumns }) {
  if (!columns.enabled) return null
  return (
    <>
      <Separator className="my-1" />
      <Button
        variant="ghost"
        size="sm"
        className="justify-start font-normal"
        disabled={!columns.customised}
        onClick={() => columns.reset()}
      >
        <RotateCcw />
        {translate('resetColumnWidths')}
      </Button>
    </>
  )
}
