'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import {
  layoutColumns,
  readColumnSizes,
  resizeColumn,
  writeColumnSizes,
  type ColumnSizes,
  type SizedColumn,
} from '@helvetly/ui/lib/column-sizing'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type Updater,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

/**
 * The one look of every list table: pages keep their own cells and take their classes from here,
 * so a header, row or cell never drifts per page.
 */
export const listTable = {
  table: 'table-fixed text-body-sm [&_.font-code]:text-[length:1em]',
  head: 'h-11 text-left text-[11px] tracking-[0.04em] text-muted-foreground uppercase',
  th: 'sticky top-0 z-10 border-b bg-card bg-linear-to-b from-muted/50 to-muted/50 px-3 font-medium whitespace-nowrap first:pl-5 last:pr-5',
  row: 'h-[58px] border-b border-border/50 transition-colors duration-150 last:border-0 hover:bg-muted/40 data-open:bg-muted/50 data-selected:bg-brand-surface/60 data-attention:not-data-selected:bg-warning-surface/50',
  td: 'truncate px-3 first:pl-5 last:pr-5',
  select: 'pl-5',
  menu: 'pr-3 text-right last:pr-3',
  numeric: 'text-right tabular-nums',
  /** The phone list that replaces the table on narrow screens. */
  list: 'divide-y divide-border/70',
  item: 'flex items-center gap-3 px-4 py-3 data-selected:bg-brand-surface/60 data-attention:not-data-selected:bg-warning-surface/50',
}

/** A list column: its header, its cell and the range a person may size it in. */
export type DataColumn<T> = {
  id: string
  /** The header's text; also names the resize handle. */
  header: string
  /** Shown instead of `header`, e.g. a visually hidden label for the row menu column. */
  headerContent?: ReactNode
  cell: (row: T) => ReactNode
  /** Default width in pixels. */
  size?: number
  minSize?: number
  maxSize?: number
  /** Takes the width the other columns leave: the client, the supplier, the name. One per table. */
  flex?: boolean
  /** A person may drag its edge (default: every column but the flexible one). */
  resizable?: boolean
  /** Sorted through `sorting.onSort`. */
  sortable?: boolean
  align?: 'right'
  /** Classes for the column's cells (`td`). */
  className?: string
  /** Shown only once the table's box is at least this many pixels wide. */
  showFrom?: number
}

export type DataTableSorting = {
  column: string | undefined
  desc: boolean
  onSort: (column: string) => void
}

export type DataTableSelection<T> = {
  selected: ReadonlySet<string>
  onChange: (selected: Set<string>) => void
  allLabel: string
  rowLabel: (row: T) => string
}

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSelectionFeature,
  rowSortingFeature,
})

const SELECT = '__select'
const DEFAULT_SIZE = 140
const DEFAULT_MIN = 56
const DEFAULT_MAX = 640
const FLEX_MIN = 160
const STEP = 16

const sizedColumn = <T,>(column: DataColumn<T>): SizedColumn => ({
  id: column.id,
  size: column.size ?? DEFAULT_SIZE,
  min: column.minSize ?? (column.flex ? FLEX_MIN : DEFAULT_MIN),
  max: column.maxSize ?? (column.flex ? Number.POSITIVE_INFINITY : DEFAULT_MAX),
  flex: column.flex,
})

const canResize = <T,>(column: DataColumn<T>) => !column.flex && (column.resizable ?? true)

/** The width of the box the table sits in, measured before paint and on every resize. */
function useBoxWidth() {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = box.current
    if (!node) return
    setWidth(node.clientWidth)
    const observer = new ResizeObserver(() => setWidth(node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { box, width }
}

/**
 * A list table on TanStack Table: row selection, server-side sorting, and column widths a person
 * drags (live, kept per table in this browser). The flexible column fills what the others leave,
 * so the table always fills its box; a column stops where the flexible one reaches its min.
 */
export function DataTable<T extends RowData>({
  id,
  label,
  columns,
  data,
  getRowId,
  sorting,
  selection,
  onRowClick,
  rowProps,
  renderRow,
  className,
  pending,
  footer,
}: {
  /** Names the stored widths: one per list. */
  id: string
  /** The table's accessible name. */
  label?: string
  columns: readonly DataColumn<T>[]
  data: readonly T[]
  getRowId: (row: T) => string
  sorting?: DataTableSorting
  selection?: DataTableSelection<T>
  /** A click on the row outside its controls. */
  onRowClick?: (row: T) => void
  /** Extra attributes for a row, e.g. `data-open`, `onPointerEnter`. */
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, unknown>
  /** Wraps a row, e.g. in its context menu. */
  renderRow?: (row: T, tr: ReactElement) => ReactNode
  /** Classes for the `<table>`, e.g. `hidden @4xl:table`. */
  className?: string
  /** Shows the rows dimmed while the next ones load. */
  pending?: boolean
  /** Under the table: the pager. */
  footer?: ReactNode
}) {
  const { box, width: available } = useBoxWidth()
  const [sizes, setSizes] = useState<ColumnSizes>(() =>
    readColumnSizes(
      id,
      columns.filter(canResize).map((column) => column.id),
    ),
  )

  const shown = columns.filter((column) => !column.showFrom || available >= column.showFrom)
  const sized = [
    ...(selection ? [{ id: SELECT, size: 40, min: 40, max: 40 }] : []),
    ...shown.map(sizedColumn),
  ]
  const widths = layoutColumns(sized, available, sizes)
  const total = sized.reduce((sum, column) => sum + (widths[column.id] ?? 0), 0)

  const byId = new Map(columns.map((column) => [column.id, column]))
  // What the table model needs of each column, as one string: a new columns array each render
  // keeps the same model.
  const shape = [
    selection ? SELECT : '',
    ...columns.map(
      (column) => `${column.id}:${canResize(column) ? 1 : 0}${column.sortable ? 1 : 0}`,
    ),
  ].join(',')
  const defs = useMemo(
    () =>
      shape
        .split(',')
        .filter(Boolean)
        .map((entry): ColumnDef<typeof features, T> => {
          const [column = '', flags = '00'] = entry.split(':')
          return { id: column, enableResizing: flags[0] === '1', enableSorting: flags[1] === '1' }
        }),
    [shape],
  )

  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries([...(selection?.selected ?? [])].map((row) => [row, true])),
    [selection?.selected],
  )

  const table = useTable({
    features,
    columns: defs,
    data: data as T[],
    getRowId: (row: T) => getRowId(row),
    manualSorting: true,
    columnResizeMode: 'onChange',
    enableRowSelection: Boolean(selection),
    state: {
      columnSizing: { ...sizes },
      columnVisibility: Object.fromEntries(
        columns.map((column) => [column.id, shown.includes(column)]),
      ),
      rowSelection,
      sorting: sorting?.column ? [{ id: sorting.column, desc: sorting.desc }] : [],
    },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      selection?.onChange(new Set(Object.keys(next).filter((row) => next[row])))
    },
  })

  const commit = (next: ColumnSizes) => {
    setSizes(next)
    writeColumnSizes(id, next)
  }
  const resized = (from: ColumnSizes, column: string, width: number) => ({
    ...from,
    [column]: resizeColumn(sized, available, from, column, width),
  })

  const startDrag = (event: PointerEvent<HTMLElement>, column: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    const x = event.clientX
    const start = widths[column] ?? 0
    const from = sizes
    let last = from
    const follow = (move: globalThis.PointerEvent) => {
      last = resized(from, column, start + move.clientX - x)
      setSizes(last)
    }
    const end = () => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      table.resetHeaderSizeInfo()
      if (last !== from) commit(last)
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const onHandleKey = (event: KeyboardEvent<HTMLElement>, column: string) => {
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(withoutSize(sizes, column))
      return
    }
    if (!direction) return
    event.preventDefault()
    const step = event.shiftKey ? STEP * 4 : STEP
    commit(resized(sizes, column, (widths[column] ?? 0) + direction * step))
  }

  const allSelected = table.getIsAllRowsSelected()
  const someSelected = table.getIsSomeRowsSelected()

  return (
    <div
      ref={box}
      className={cn('overflow-x-clip transition-opacity duration-150', pending && 'opacity-60')}
    >
      <table aria-label={label} className={cn(listTable.table, className)} style={{ width: total }}>
        <colgroup>
          {sized.map((column) => (
            <col key={column.id} style={{ width: widths[column.id] }} />
          ))}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className={listTable.head}>
              {group.headers.map((header) => {
                if (header.column.id === SELECT)
                  return (
                    <th key={header.id} className={cn(listTable.th, listTable.select)}>
                      <Checkbox
                        aria-label={selection?.allLabel}
                        className="cursor-pointer bg-card align-middle"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
                      />
                    </th>
                  )
                const column = byId.get(header.column.id)
                if (!column) return null
                const sorted = sorting?.column === column.id
                return (
                  <th
                    key={header.id}
                    aria-sort={sorted ? (sorting.desc ? 'descending' : 'ascending') : undefined}
                    // The resize handle inside would add its width to the header's name.
                    aria-label={header.column.getCanResize() ? column.header : undefined}
                    className={cn(
                      listTable.th,
                      'group/th relative',
                      column.align === 'right' && 'text-right',
                      column.id === 'actions' && listTable.menu,
                    )}
                  >
                    <span className="block truncate">
                      {column.headerContent ??
                        (column.sortable && sorting ? (
                          <button
                            type="button"
                            onClick={() => sorting.onSort(column.id)}
                            className={cn(
                              'inline-flex max-w-full cursor-pointer items-center gap-1 uppercase hover:text-foreground',
                              sorted && 'text-foreground',
                            )}
                          >
                            <span className="truncate">{column.header}</span>
                            {sorted &&
                              (sorting.desc ? (
                                <ArrowDown className="size-3.5 shrink-0" />
                              ) : (
                                <ArrowUp className="size-3.5 shrink-0" />
                              ))}
                          </button>
                        ) : (
                          column.header
                        ))}
                    </span>
                    {header.column.getCanResize() && (
                      <ResizeHandle
                        label={column.header}
                        width={widths[column.id] ?? 0}
                        min={sizedColumn(column).min}
                        max={resizeColumn(sized, available, sizes, column.id, Infinity)}
                        onPointerDown={(event) => startDrag(event, column.id)}
                        onKeyDown={(event) => onHandleKey(event, column.id)}
                        onDoubleClick={() => commit(withoutSize(sizes, column.id))}
                        onChange={(next) => commit(resized(sizes, column.id, next))}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const original = row.original
            const extra = rowProps?.(original)
            const tr = (
              <tr
                key={row.id}
                data-selected={row.getIsSelected() || undefined}
                {...extra}
                onClick={
                  onRowClick
                    ? (event: MouseEvent<HTMLTableRowElement>) => {
                        const target = event.target
                        if (
                          !(target instanceof Element) ||
                          !event.currentTarget.contains(target) ||
                          target.closest('button, a, [role=checkbox], input')
                        )
                          return
                        onRowClick(original)
                      }
                    : undefined
                }
                className={cn(listTable.row, onRowClick && 'cursor-pointer', extra?.className)}
              >
                {row.getVisibleCells().map((cell) => {
                  if (cell.column.id === SELECT)
                    return (
                      <td key={cell.id} className={cn(listTable.td, listTable.select)}>
                        <Checkbox
                          aria-label={selection?.rowLabel(original)}
                          className="cursor-pointer bg-card align-middle"
                          checked={row.getIsSelected()}
                          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
                        />
                      </td>
                    )
                  const column = byId.get(cell.column.id)
                  if (!column) return null
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        listTable.td,
                        column.align === 'right' && listTable.numeric,
                        column.id === 'actions' && listTable.menu,
                        column.className,
                      )}
                    >
                      {column.cell(original)}
                    </td>
                  )
                })}
              </tr>
            )
            return renderRow ? <WrappedRow key={row.id}>{renderRow(original, tr)}</WrappedRow> : tr
          })}
        </tbody>
      </table>
      {footer}
    </div>
  )
}

/** Gives a wrapped row (its context menu) a key without adding markup. */
function WrappedRow({ children }: { children: ReactNode }) {
  return children
}

const withoutSize = (sizes: ColumnSizes, column: string) =>
  Object.fromEntries(Object.entries(sizes).filter(([entry]) => entry !== column))

/**
 * A column's right edge: drag it, or focus it and use the arrow keys (Shift: bigger steps);
 * double-click or Enter gives the column its default width again. Shown on header hover.
 */
function ResizeHandle({
  label,
  width,
  min,
  max,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
  onChange,
}: {
  label: string
  width: number
  min: number
  max: number
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onDoubleClick: () => void
  onChange: (width: number) => void
}) {
  return (
    <span
      data-column-resizer=""
      className="group/resizer absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2"
    >
      {/* A range input: focusable, announced with the width as its value, arrow keys native. */}
      <input
        type="range"
        aria-label={translate('tableResizeColumn', { column: label })}
        min={min}
        max={Math.max(min, max)}
        step={1}
        value={Math.round(width)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        onClick={(event) => event.stopPropagation()}
        className="peer absolute inset-0 m-0 h-full w-full cursor-col-resize touch-none appearance-none opacity-0"
      />
      <span className="pointer-events-none absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-border opacity-0 transition-opacity group-hover/th:opacity-100 peer-focus-visible:bg-ring peer-focus-visible:opacity-100 peer-active:bg-ring peer-active:opacity-100" />
    </span>
  )
}

type PageMeta = { page: number; page_size: number; total: number; total_pages: number }

/** The footer under a paged list: the range shown, then previous and next. */
export function Pager({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  return (
    <nav
      aria-label={translate('tablePages')}
      className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-[13px] text-muted-foreground md:px-5"
    >
      <span className="tabular-nums">
        {translate('tableRange', {
          from: (meta.page - 1) * meta.page_size + 1,
          to: Math.min(meta.page * meta.page_size, meta.total),
          total: meta.total,
        })}
      </span>
      <span className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('tablePreviousPage')}
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular-nums">
          {translate('tablePageOf', { page: meta.page, pages: Math.max(meta.total_pages, 1) })}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={translate('tableNextPage')}
          disabled={meta.page >= meta.total_pages}
          onClick={() => onPage(meta.page + 1)}
        >
          <ChevronRight />
        </Button>
      </span>
    </nav>
  )
}
