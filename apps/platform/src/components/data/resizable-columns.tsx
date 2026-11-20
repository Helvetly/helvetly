'use client'
import { Button } from '@helvetly/ui/components/button'
import { Separator } from '@helvetly/ui/components/separator'
import { cn } from '@helvetly/ui/lib/utils'
import { RotateCcw } from 'lucide-react'
import {
  useCallback,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type PointerEvent,
} from 'react'

import { readColumnWidths, writeColumnWidths, type ColumnWidths } from '@/lib/column-widths'
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

type Limits = { min?: number; max?: number }

const MIN = 64
const MAX = 640
/** The least the flexible column keeps once any column was resized; more scrolls the table. */
const FLEX_MIN = 160
/** The flexible column may grow past the page: the table scrolls. */
const FLEX_MAX = 1600
const STEP = 16

/**
 * Widens `table` until its flexible column is `target` wide: the table fills its box as before,
 * and scrolls sideways only when the columns need more. No target: the table's own width again.
 */
function fit(table: HTMLTableElement, flex: string, target: number | undefined) {
  table.style.minWidth = ''
  const head = table.querySelector<HTMLElement>(`th[data-column="${flex}"]`)
  if (target === undefined || !head || !table.offsetWidth) return
  // Percentage columns grow with the table, so a step or two more settles it.
  for (let step = 0; step < 4; step++) {
    const short = target - head.getBoundingClientRect().width
    if (short < 0.5) return
    table.style.minWidth = `${table.getBoundingClientRect().width + short}px`
  }
}

export type ResizableColumns = ReturnType<typeof useResizableColumns>

/**
 * Column widths a person drags, kept per table in this browser. Every column but `flex` gets the
 * dragged width; `flex` (the client, the name) takes the rest of the row, and its dragged width is
 * what it keeps at least, the table scrolling sideways when the columns no longer fit.
 */
export function useResizableColumns(
  table: string,
  columns: readonly string[],
  { flex, limits = {} }: { flex: string; limits?: Partial<Record<string, Limits>> },
) {
  const enabled = useWide()
  const [widths, setWidths] = useState<ColumnWidths>(() => readColumnWidths(table, columns))
  const target = enabled && Object.keys(widths).length > 0 ? (widths[flex] ?? FLEX_MIN) : undefined

  // A callback ref with a cleanup: it runs again for a new table, target or flexible column.
  const fitTable = useCallback(
    (element: HTMLTableElement | null) => {
      if (!element) return
      fit(element, flex, target)
      const scroller = element.parentElement
      if (!scroller || target === undefined) return
      const observer = new ResizeObserver(() => fit(element, flex, target))
      observer.observe(scroller)
      return () => observer.disconnect()
    },
    [flex, target],
  )

  const clamp = (column: string, width: number) =>
    Math.round(
      Math.min(
        Math.max(width, limits[column]?.min ?? (column === flex ? FLEX_MIN : MIN)),
        limits[column]?.max ?? (column === flex ? FLEX_MAX : MAX),
      ),
    )

  const commit = (column: string, width: number | undefined) => {
    const next = { ...widths }
    if (width === undefined) delete next[column]
    else next[column] = clamp(column, width)
    setWidths(next)
    writeColumnWidths(table, columns, next)
  }

  return {
    enabled,
    fitTable,
    customised: Object.keys(widths).length > 0,
    clamp,
    commit,
    /** Shows a width while dragging, before it is committed. */
    preview: (column: string, width: number, head: HTMLTableCellElement) => {
      const element = head.closest('table')
      if (!element) return
      if (column === flex) return fit(element, flex, width)
      head.style.width = `${width}px`
      fit(element, flex, widths[flex] ?? FLEX_MIN)
    },
    reset: () => {
      setWidths({})
      writeColumnWidths(table, columns, {})
    },
    /** Props for a column's `<th>`: its dragged width, and where the handle finds it. */
    head: (column: string) => ({
      'data-column': column,
      style:
        enabled && column !== flex && widths[column] !== undefined
          ? { width: widths[column] }
          : undefined,
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
  const [width, setWidth] = useState<number>()
  const [dragging, setDragging] = useState(false)
  if (!columns.enabled) return null
  const min = columns.clamp(column, 0)

  const onPointerDown = (event: PointerEvent<HTMLInputElement>) => {
    const handle = event.currentTarget
    const head = handle.closest('th')
    if (event.button !== 0 || !head) return
    // Not the range's own jump to where it was pressed: the edge follows the pointer.
    event.preventDefault()
    handle.focus({ preventScroll: true })
    const x = event.clientX
    const start = widthOf(handle)
    let last = start
    setWidth(start)
    setDragging(true)
    const follow = (move: globalThis.PointerEvent) => {
      last = columns.clamp(column, start + move.clientX - x)
      setWidth(last)
      columns.preview(column, last, head)
    }
    const end = () => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDragging(false)
      if (last !== start) columns.commit(column, last)
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  return (
    <span
      data-dragging={dragging || undefined}
      className="group/resizer absolute inset-y-0 -right-1.5 z-10 w-3"
    >
      <input
        type="range"
        aria-label={translate('resizeColumn', { column: label })}
        min={min}
        max={columns.clamp(column, Number.POSITIVE_INFINITY)}
        step={STEP}
        value={width ?? min}
        onChange={(event) => {
          const next = columns.clamp(column, Number(event.target.value))
          setWidth(next)
          columns.commit(column, next)
        }}
        onFocus={(event) => setWidth(widthOf(event.currentTarget))}
        onKeyDown={(event) => {
          const direction = KEYS[event.key]
          if (!direction) return
          // Our own steps from the column's width now (Shift: four), not the range's.
          event.preventDefault()
          const step = event.shiftKey ? STEP * 4 : STEP
          const next = columns.clamp(column, widthOf(event.currentTarget) + direction * step)
          setWidth(next)
          columns.commit(column, next)
        }}
        onPointerDown={onPointerDown}
        onDoubleClick={(event) => {
          const handle = event.currentTarget
          columns.commit(column, undefined)
          requestAnimationFrame(() => setWidth(widthOf(handle)))
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
        onClick={columns.reset}
      >
        <RotateCcw />
        {translate('resetColumnWidths')}
      </Button>
    </>
  )
}
