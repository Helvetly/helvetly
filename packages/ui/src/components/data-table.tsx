'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { readColumnSizes, writeColumnSizes } from '@helvetly/ui/lib/column-sizing'
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
  type ColumnSizingState,
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
  type MouseEvent,
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
  /** The checkbox column: never clipped, its focus ring included (`SELECT_SIZE`). */
  select: 'overflow-visible pr-0 pl-5 text-clip',
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

/** The checkbox column, built in (`selection`) or a page's own column of this id. */
const SELECT = 'select'
/** The checkbox column: its 20 px inset, the 16 px box and 16 px to the next column. */
const SELECT_SIZE = 52
const DEFAULT_SIZE = 140
const DEFAULT_MIN = 64
const DEFAULT_MAX = 640
const FLEX_MIN = 160
const STEP = 16

/** The select and row menu columns keep their width; the flexible one fills the rest. */
const isFixed = (id: string) => id === SELECT || id === 'actions'
const canResize = <T,>(column: DataColumn<T>) =>
  !column.flex && !isFixed(column.id) && (column.resizable ?? true)

const columnDef = <T extends RowData>(column: DataColumn<T>): ColumnDef<typeof features, T> => {
  if (column.id === SELECT)
    return {
      id: SELECT,
      size: SELECT_SIZE,
      minSize: SELECT_SIZE,
      maxSize: SELECT_SIZE,
      enableResizing: false,
    }
  const minSize = column.minSize ?? (column.flex ? FLEX_MIN : DEFAULT_MIN)
  return {
    id: column.id,
    // The flexible column's size is the least it takes; the table gives it the rest of its box.
    size: column.flex ? minSize : (column.size ?? DEFAULT_SIZE),
    minSize,
    maxSize: column.maxSize ?? (column.flex ? Number.MAX_SAFE_INTEGER : DEFAULT_MAX),
    enableResizing: canResize(column),
    enableSorting: Boolean(column.sortable),
  }
}

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
 * drags with TanStack's resizing (`onChange` mode, kept per table in this browser). The flexible
 * column fills what the others leave; once they need more than the box, the box scrolls sideways.
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
  const [sizes, setSizes] = useState<ColumnSizingState>(() =>
    readColumnSizes(
      id,
      columns.filter(canResize).map((column) => column.id),
    ),
  )

  const all = useMemo(
    () => [
      ...(selection ? [{ id: SELECT, header: selection.allLabel, cell: () => null }] : []),
      ...columns,
    ],
    [columns, selection],
  )
  const byId = new Map(all.map((column) => [column.id, column]))
  const flex = all.find((column) => column.flex)?.id
  // A new columns array each render keeps the same model while what it needs stays the same.
  const model = all.map(columnDef)
  const [defs, setDefs] = useState(model)
  if (JSON.stringify(model) !== JSON.stringify(defs)) setDefs(model)

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
      columnSizing: sizes,
      columnVisibility: Object.fromEntries(
        all.map((column) => [column.id, !column.showFrom || available >= column.showFrom]),
      ),
      rowSelection,
      sorting: sorting?.column ? [{ id: sorting.column, desc: sorting.desc }] : [],
    },
    onColumnSizingChange: (updater: Updater<ColumnSizingState>) => {
      setSizes((old) => {
        const next = typeof updater === 'function' ? updater(old) : updater
        // Kept within each column's range, so a drag past its min or max stores the width shown.
        const clamped = Object.fromEntries(
          Object.entries(next).map(([column, width]) => {
            const def = defs.find((entry) => entry.id === column)
            return [column, Math.min(Math.max(width, def?.minSize ?? 0), def?.maxSize ?? width)]
          }),
        )
        writeColumnSizes(id, clamped)
        return clamped
      })
    },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      selection?.onChange(new Set(Object.keys(next).filter((row) => next[row])))
    },
  })

  const headers = table.getFlatHeaders()
  // Sizes as CSS variables, as in TanStack's performant resizing example.
  const vars = Object.fromEntries(
    headers.map((header) => [`--col-${header.column.id}-size`, `${header.getSize()}px`]),
  )
  const total = table.getTotalSize()
  const resizing = table.state.columnResizing.isResizingColumn

  const allSelected = table.getIsAllRowsSelected()
  const someSelected = table.getIsSomeRowsSelected()

  return (
    <div
      ref={box}
      className={cn(
        // Its width comes from its parent, never from the table, so a wide table scrolls in it
        // instead of stretching a grid or flex parent.
        'transition-opacity duration-150 [contain:inline-size]',
        // Clipped while it fits, so the sticky header follows the page; scrolled once it does not.
        total > available ? 'overflow-x-auto' : 'overflow-x-clip',
        resizing && 'cursor-col-resize select-none',
        pending && 'opacity-60',
      )}
    >
      <table
        aria-label={label}
        className={cn(listTable.table, className)}
        style={{ ...vars, width: '100%', minWidth: total }}
      >
        <colgroup>
          {headers.map((header) => (
            <col
              key={header.id}
              style={{
                width:
                  header.column.id === flex ? undefined : `var(--col-${header.column.id}-size)`,
              }}
            />
          ))}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className={listTable.head}>
              {group.headers.map((header) => {
                const column = byId.get(header.column.id)
                if (!column) return null
                if (column.id === SELECT && selection)
                  return (
                    <th key={header.id} className={cn(listTable.th, listTable.select)}>
                      <Checkbox
                        aria-label={selection.allLabel}
                        className="cursor-pointer bg-card"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(checked) => table.toggleAllRowsSelected(checked === true)}
                      />
                    </th>
                  )
                const sorted = sorting?.column === column.id
                const canResizeColumn = header.column.getCanResize()
                return (
                  <th
                    key={header.id}
                    aria-sort={sorted ? (sorting.desc ? 'descending' : 'ascending') : undefined}
                    // The resize handle inside would add its name to the header's.
                    aria-label={canResizeColumn ? column.header : undefined}
                    className={cn(
                      listTable.th,
                      'group/th relative',
                      column.align === 'right' && 'text-right',
                      column.id === SELECT && listTable.select,
                      column.id === 'actions' && listTable.menu,
                    )}
                  >
                    <span className={cn('block', column.id !== SELECT && 'truncate')}>
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
                    {canResizeColumn && (
                      <ResizeHandle
                        label={column.header}
                        width={header.getSize()}
                        min={header.column.columnDef.minSize ?? DEFAULT_MIN}
                        max={header.column.columnDef.maxSize ?? DEFAULT_MAX}
                        active={resizing === column.id}
                        onStart={header.getResizeHandler()}
                        onChange={(width) =>
                          table.setColumnSizing((old) => ({ ...old, [column.id]: width }))
                        }
                        onReset={() => header.column.resetSize()}
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
                  const column = byId.get(cell.column.id)
                  if (!column) return null
                  if (column.id === SELECT && selection)
                    return (
                      <td key={cell.id} className={cn(listTable.td, listTable.select)}>
                        <Checkbox
                          aria-label={selection.rowLabel(original)}
                          className="cursor-pointer bg-card"
                          checked={row.getIsSelected()}
                          onCheckedChange={(checked) => row.toggleSelected(checked === true)}
                        />
                      </td>
                    )
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        listTable.td,
                        column.align === 'right' && listTable.numeric,
                        column.id === SELECT && listTable.select,
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

/**
 * A column's right edge: TanStack's resize handler on mouse and touch; a double-click or Enter
 * gives the column its default width again. A range input, so it is focusable and announced with
 * the width as its value; the arrow keys resize in steps (Shift: bigger ones).
 */
function ResizeHandle({
  label,
  width,
  min,
  max,
  active,
  onStart,
  onChange,
  onReset,
}: {
  label: string
  width: number
  min: number
  max: number
  active: boolean
  onStart: (event: unknown) => void
  onChange: (width: number) => void
  onReset: () => void
}) {
  return (
    <span
      data-column-resizer=""
      data-resizing={active || undefined}
      // Inside its own header: centred on the border, the next sticky header would cover its half.
      className="group/resizer absolute inset-y-0 right-0 z-10 flex w-3 justify-end"
    >
      <input
        type="range"
        aria-label={translate('tableResizeColumn', { column: label })}
        min={min}
        max={Math.max(min, max)}
        step={1}
        value={Math.round(width)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          // Not the range's own drag, no text selection, no sort click.
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          onStart(event)
        }}
        onTouchStart={onStart}
        onKeyDown={(event) => {
          const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
          if (event.key === 'Enter') onReset()
          else if (direction) onChange(width + direction * (event.shiftKey ? STEP * 4 : STEP))
          else return
          event.preventDefault()
        }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={onReset}
        className="peer absolute inset-0 m-0 h-full w-full cursor-col-resize touch-none appearance-none opacity-0"
      />
      <span className="pointer-events-none my-2.5 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover/resizer:bg-ring group-hover/th:opacity-100 group-data-resizing/resizer:bg-ring group-data-resizing/resizer:opacity-100 peer-focus-visible:bg-ring peer-focus-visible:opacity-100" />
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
