'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { translate } from '@helvetly/ui/lib/i18n'
import { pageItems } from '@helvetly/ui/lib/page-items'
import {
  PAGE_SIZES,
  readColumnSizes,
  useColumnOrder,
  writeColumnSizes,
} from '@helvetly/ui/lib/table-storage'
import { cn } from '@helvetly/ui/lib/utils'
import {
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table'
import {
  elementScroll,
  Virtualizer,
  type Rect,
  type VirtualizerOptions,
} from '@tanstack/react-virtual'
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react'
import {
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
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
  row: 'h-[58px] border-b border-border/50 transition-colors duration-150 last:border-0 not-data-selected:hover:bg-muted/40 data-open:bg-muted/50 data-selected:bg-brand-surface/60 data-attention:not-data-selected:bg-warning-surface/50',
  // A badge in a cell is the small one (Badge `size="sm"`), whichever component draws it.
  td: 'truncate px-3 first:pl-5 last:pr-5 [&_[data-slot=badge]]:h-5 [&_[data-slot=badge]]:gap-1 [&_[data-slot=badge]]:px-1.5 [&_[data-slot=badge]]:text-caption [&_[data-slot=badge]>svg]:size-3',
  /** The checkbox column: never clipped, its focus ring included (`SELECT_SIZE`). */
  select: 'overflow-visible pr-0 pl-5 text-clip',
  menu: 'px-2 text-right last:pr-2',
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
  /**
   * Its default width is what the other columns leave of the box: the client, the supplier, the
   * name. One per table. Once a person resizes any column it keeps the width it had.
   */
  flex?: boolean
  /** Sorted through `sorting.onSort`. */
  sortable?: boolean
  /** The first click sorts it descending (dates, amounts): TanStack's `sortDescFirst`. */
  sortDescFirst?: boolean
  align?: 'right'
  /** Classes for the column's cells (`td`). */
  className?: string
  /** Shown only once the table's box is at least this many pixels wide. */
  showFrom?: number
}

/** The server-side sort: one column at a time, never removed (a click turns its direction). */
export type DataTableSorting = {
  column: string | undefined
  desc: boolean
  onSort: (column: string, desc: boolean) => void
}

/** The server-side paging: `page` counts from 1, `total` is every row the query matches. */
export type DataTablePagination = {
  page: number
  pageSize: number
  total: number
  onChange: (page: number, pageSize: number) => void
}

export type DataTableSelection<T> = {
  selected: ReadonlySet<string>
  onChange: (selected: Set<string>) => void
  allLabel: string
  rowLabel: (row: T) => string
}

const features = tableFeatures({
  columnOrderingFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
})

/** The checkbox column, built in (`selection`) or a page's own column of this id. */
const SELECT = 'select'
const ACTIONS = 'actions'
/** The checkbox column: its 20 px inset, the 16 px box and 16 px to the next column. */
const SELECT_SIZE = 52
/** The row menu column: one icon button. */
const ACTIONS_SIZE = 48
const DEFAULT_SIZE = 140
const FLEX_SIZE = 240
const DEFAULT_MIN = 64
const DEFAULT_MAX = 640
const FLEX_MIN = 160
const STEP = 16
/** `listTable.row`'s height. */
const ROW_HEIGHT = 58
/** Longer lists render only the rows in view; a page of 50 or 100 renders plainly. */
const VIRTUAL_FROM = 100

/** The checkbox and row menu columns keep their width and their place. */
const isFixed = (id: string) => id === SELECT || id === ACTIONS
const canResize = <T,>(column: DataColumn<T>) => !isFixed(column.id)

/** A column's default width and its range. */
function bounds<T>(column: DataColumn<T>) {
  if (column.id === SELECT) return { size: SELECT_SIZE, min: SELECT_SIZE, max: SELECT_SIZE }
  if (column.id === ACTIONS) {
    const size = column.size ?? ACTIONS_SIZE
    return { size, min: size, max: size }
  }
  const min = column.minSize ?? (column.flex ? FLEX_MIN : DEFAULT_MIN)
  const max = column.maxSize ?? (column.flex ? Number.MAX_SAFE_INTEGER : DEFAULT_MAX)
  return { size: column.size ?? Math.max(min, column.flex ? FLEX_SIZE : DEFAULT_SIZE), min, max }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const columnDef = <T extends RowData>(column: DataColumn<T>): ColumnDef<typeof features, T> => {
  const { size, min, max } = bounds(column)
  return {
    id: column.id,
    size,
    minSize: min,
    maxSize: max,
    enableResizing: canResize(column),
    enableSorting: Boolean(column.sortable),
    // TanStack sorts only columns with an accessor; the rows come sorted from the server.
    accessorFn: () => null,
    // Set either way: without it TanStack guesses from the first row's value, which we have none of.
    sortDescFirst: Boolean(column.sortDescFirst),
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

/** The nearest ancestor that scrolls vertically: a drawer's body, or the page itself. */
function scrollParent(node: Element | null): Element | null {
  for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return document.scrollingElement
}

const isRoot = (element: Element) => element === document.scrollingElement

// The page's scroll fires on the window and its viewport is the window's, not <html>'s box.
function observeRect(
  instance: Virtualizer<Element, HTMLTableRowElement>,
  update: (rect: Rect) => void,
) {
  const element = instance.scrollElement
  if (!element) return
  const measure = () =>
    update({
      width: element.clientWidth,
      height: isRoot(element) ? window.innerHeight : element.clientHeight,
    })
  measure()
  if (isRoot(element)) {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  return () => observer.disconnect()
}

function observeOffset(
  instance: Virtualizer<Element, HTMLTableRowElement>,
  update: (offset: number, isScrolling: boolean) => void,
) {
  const element = instance.scrollElement
  if (!element) return
  const target = isRoot(element) ? window : element
  const measure = () => update(element.scrollTop, false)
  measure()
  target.addEventListener('scroll', measure, { passive: true })
  return () => target.removeEventListener('scroll', measure)
}

/**
 * TanStack Virtual's `useVirtualizer` for the rows, on its `Virtualizer` directly (the hook is one
 * the React Compiler rules refuse): one instance, its options set each render, then its mount and
 * update steps; it re-renders when the rows in view change. The page or a drawer is what scrolls.
 */
function useRowVirtualizer(
  options: Omit<
    VirtualizerOptions<Element, HTMLTableRowElement>,
    'observeElementRect' | 'observeElementOffset' | 'scrollToFn' | 'onChange'
  >,
) {
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const resolved: VirtualizerOptions<Element, HTMLTableRowElement> = {
    ...options,
    observeElementRect: observeRect,
    observeElementOffset: observeOffset,
    scrollToFn: elementScroll,
    onChange: () => rerender(),
  }
  const [instance] = useState(() => new Virtualizer(resolved))
  instance.setOptions(resolved)
  useLayoutEffect(() => instance._didMount(), [instance])
  useLayoutEffect(() => instance._willUpdate())
  return instance
}

/**
 * A list table on TanStack Table, as in TanStack's examples: every column has its own width a
 * person drags (`onChange` resizing, widths as CSS variables, kept per table in this browser) and
 * the table is as wide as its columns, scrolling sideways in its box when wider; headers sort
 * through the server (`manualSorting`) and move by dragging (`columnOrder`, kept per table);
 * `pagination` puts TanStack's pager under it (`manualPagination`); long lists render only the
 * rows in view.
 */
export function DataTable<T extends RowData>({
  id,
  label,
  columns,
  data,
  getRowId,
  sorting,
  pagination,
  selection,
  onRowClick,
  rowProps,
  renderRow,
  className,
  pending,
  footer,
}: {
  /** Names the stored widths, order and page size: one per list. */
  id: string
  /** The table's accessible name. */
  label?: string
  columns: readonly DataColumn<T>[]
  data: readonly T[]
  getRowId: (row: T) => string
  sorting?: DataTableSorting
  pagination?: DataTablePagination
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
  /** Under the table, above the pager: e.g. the phone list that replaces it on narrow screens. */
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
  const shown = all.filter((column) => !column.showFrom || available >= column.showFrom)
  // A new columns array each render keeps the same model while what it needs stays the same.
  const model = all.map(columnDef)
  const [defs, setDefs] = useState(model)
  if (JSON.stringify(model) !== JSON.stringify(defs)) setDefs(model)

  // Until a person sizes them, the columns share what the box has beyond their default widths;
  // the first resize of any column stores every width, so only the dragged one moves.
  const columnSizing = useMemo(() => fitColumns(shown, sizes, available), [shown, sizes, available])

  const movable = all.filter((column) => !isFixed(column.id)).map((column) => column.id)
  const { order, setOrder } = useColumnOrder(id, movable)
  const columnOrder = useMemo<ColumnOrderState>(
    () => [
      ...all.filter((column) => column.id === SELECT).map((column) => column.id),
      ...order,
      ...all.filter((column) => column.id === ACTIONS).map((column) => column.id),
    ],
    [all, order],
  )

  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries([...(selection?.selected ?? [])].map((row) => [row, true])),
    [selection?.selected],
  )
  const sortColumn = sorting?.column
  const sortDesc = sorting?.desc ?? false
  const sortingState = useMemo<SortingState>(
    () => (sortColumn ? [{ id: sortColumn, desc: sortDesc }] : []),
    [sortColumn, sortDesc],
  )
  const paginationState = useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max((pagination?.page ?? 1) - 1, 0),
      pageSize: pagination?.pageSize ?? Math.max(data.length, 1),
    }),
    [pagination?.page, pagination?.pageSize, data.length],
  )

  const table = useTable({
    features,
    columns: defs,
    data: data as T[],
    getRowId: (row: T) => getRowId(row),
    columnResizeMode: 'onChange',
    columnResizeDirection: 'ltr',
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    manualPagination: true,
    rowCount: pagination?.total ?? data.length,
    enableRowSelection: Boolean(selection),
    state: {
      columnSizing,
      columnOrder,
      columnVisibility: Object.fromEntries(
        all.map((column) => [column.id, shown.includes(column)]),
      ),
      rowSelection,
      sorting: sortingState,
      pagination: paginationState,
    },
    onColumnSizingChange: (updater: Updater<ColumnSizingState>) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater
      writeColumnSizes(id, next)
      setSizes(next)
    },
    onColumnOrderChange: (updater: Updater<ColumnOrderState>) => {
      const next = typeof updater === 'function' ? updater(columnOrder) : updater
      setOrder(next.filter((column) => !isFixed(column)))
    },
    onSortingChange: (updater: Updater<SortingState>) => {
      const [next] = typeof updater === 'function' ? updater(sortingState) : updater
      if (next) sorting?.onSort(next.id, next.desc)
    },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = typeof updater === 'function' ? updater(paginationState) : updater
      pagination?.onChange(next.pageIndex + 1, next.pageSize)
    },
    onRowSelectionChange: (updater: Updater<RowSelectionState>) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      selection?.onChange(new Set(Object.keys(next).filter((row) => next[row])))
    },
  })

  const headers = table.getFlatHeaders()
  const sizing = table.state.columnSizing
  // As in TanStack's performant example: the widths as CSS variables, built once per change.
  const columnSizeVars = useMemo(
    () =>
      Object.fromEntries(
        headers.map((header) => [
          `--col-${header.column.id}-size`,
          `${clamp(sizing[header.column.id] ?? header.column.columnDef.size ?? DEFAULT_SIZE, header.column.columnDef.minSize ?? 0, header.column.columnDef.maxSize ?? DEFAULT_MAX)}px`,
        ]),
      ),
    [headers, sizing],
  )
  const total = table.getTotalSize()
  // Narrower than its box: the empty room right of the columns is a cell of its own, so the
  // header and every row's hover and border still reach the box's edge.
  const filler = available > total
  const resizing = table.state.columnResizing.isResizingColumn
  const visibleColumns = table.getVisibleLeafColumns()
  const lastColumn = visibleColumns.at(-1)?.id
  // A bar sits only between two data columns: none after the last one, so none at the row menu's edge.
  const lastDataColumn = visibleColumns.findLast((column) => column.getCanResize())?.id
  // The row menu column stays at the right edge: the empty room goes before it.
  const fillerAt = lastColumn === ACTIONS ? visibleColumns.length - 1 : visibleColumns.length
  const withFiller = (cells: ReactNode[], cell: ReactNode) =>
    filler ? [...cells.slice(0, fillerAt), cell, ...cells.slice(fillerAt)] : cells

  const rows = table.getRowModel().rows
  const tbody = useRef<HTMLTableSectionElement>(null)
  const virtual = rows.length > VIRTUAL_FROM
  const [scrollMargin, setScrollMargin] = useState(0)
  const virtualizer = useRowVirtualizer({
    count: rows.length,
    enabled: virtual,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getScrollElement: () => scrollParent(box.current),
    scrollMargin,
  })
  // Where the rows start inside what scrolls, so the virtualizer counts from the first row.
  useLayoutEffect(() => {
    const element = virtualizer.scrollElement
    if (!virtual || !element || !tbody.current) return
    const top =
      tbody.current.getBoundingClientRect().top -
      (isRoot(element) ? 0 : element.getBoundingClientRect().top) +
      element.scrollTop
    if (Math.abs(top - scrollMargin) > 1) setScrollMargin(top)
  }, [virtual, virtualizer, scrollMargin])
  const items = virtual ? virtualizer.getVirtualItems() : []
  const slice = virtual
    ? {
        rows: items.flatMap((item) => rows[item.index] ?? []),
        before: (items[0]?.start ?? scrollMargin) - scrollMargin,
        after: virtualizer.getTotalSize() - ((items.at(-1)?.end ?? scrollMargin) - scrollMargin),
      }
    : { rows, before: 0, after: 0 }

  const [dropTarget, setDropTarget] = useState<string>()
  const dragged = useRef<string>(undefined)
  const moveColumn = (from: string, to: string) => {
    if (from === to || isFixed(to)) return
    table.setColumnOrder((old) => {
      const next = old.filter((column) => column !== from)
      next.splice(old.indexOf(to), 0, from)
      return next
    })
  }

  const allSelected = table.getIsAllRowsSelected()
  const someSelected = table.getIsSomeRowsSelected()
  const spacer = (height: number, key: string) =>
    height > 0 && (
      <tr key={key} aria-hidden style={{ height }}>
        <td aria-hidden colSpan={visibleColumns.length + Number(filler)} className="p-0" />
      </tr>
    )

  return (
    <div className={cn('transition-opacity duration-150', pending && 'opacity-60')}>
      <div
        ref={box}
        className={cn(
          // Its width comes from its parent, never from the table, so a wide table scrolls in it
          // instead of stretching a grid or flex parent.
          '[contain:inline-size]',
          // Clipped while it fits, so the sticky header follows the page; scrolled once it does not.
          total > available ? 'overflow-x-auto' : 'overflow-x-clip',
          resizing && 'cursor-col-resize select-none',
        )}
      >
        <table
          aria-label={label}
          aria-rowcount={virtual ? rows.length + 1 : undefined}
          className={cn(listTable.table, className)}
          style={{ ...columnSizeVars, width: filler ? available : total }}
        >
          <colgroup>
            {withFiller(
              headers.map((header) => (
                <col key={header.id} style={{ width: `var(--col-${header.column.id}-size)` }} />
              )),
              <col key="filler" />,
            )}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className={listTable.head}>
                {withFiller(
                  group.headers.map((header) => {
                    const column = byId.get(header.column.id)
                    if (!column) return null
                    if (column.id === SELECT && selection)
                      return (
                        <th key={header.id} className={cn(listTable.th, listTable.select)}>
                          <Checkbox
                            aria-label={selection.allLabel}
                            className="cursor-pointer bg-card"
                            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                            onCheckedChange={(checked) =>
                              table.toggleAllRowsSelected(checked === true)
                            }
                          />
                        </th>
                      )
                    const sorted = header.column.getIsSorted()
                    const canResizeColumn =
                      header.column.getCanResize() && column.id !== lastDataColumn
                    const canMove = !isFixed(column.id)
                    return (
                      <th
                        key={header.id}
                        aria-sort={
                          sorted ? (sorted === 'desc' ? 'descending' : 'ascending') : undefined
                        }
                        // The resize handle inside would add its name to the header's.
                        aria-label={canResizeColumn ? column.header : undefined}
                        data-drop-target={dropTarget === column.id || undefined}
                        onDragOver={(event: DragEvent) => {
                          if (!canMove || dragged.current === undefined) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDropTarget(column.id)
                        }}
                        onDragLeave={() =>
                          setDropTarget((target) => (target === column.id ? undefined : target))
                        }
                        onDrop={(event: DragEvent) => {
                          event.preventDefault()
                          if (dragged.current !== undefined) moveColumn(dragged.current, column.id)
                          setDropTarget(undefined)
                        }}
                        className={cn(
                          listTable.th,
                          'group/th relative data-drop-target:bg-muted',
                          column.align === 'right' && 'text-right',
                          column.id === SELECT && listTable.select,
                          column.id === ACTIONS && listTable.menu,
                          filler && column.id === lastColumn && column.id !== ACTIONS && 'pr-5',
                        )}
                      >
                        <span
                          className={cn(
                            'block',
                            column.id !== SELECT && 'truncate',
                            canMove && 'cursor-grab',
                          )}
                          // Not while a column is resized: Chromium would start the drag once the
                          // widened column brings this label under the point the press began at.
                          draggable={canMove && !resizing}
                          onDragStart={(event: DragEvent) => {
                            if (resizing) {
                              event.preventDefault()
                              return
                            }
                            dragged.current = column.id
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', column.header)
                          }}
                          onDragEnd={() => {
                            dragged.current = undefined
                            setDropTarget(undefined)
                          }}
                        >
                          {column.headerContent ??
                            (header.column.getCanSort() && sorting ? (
                              <button
                                type="button"
                                onClick={header.column.getToggleSortingHandler()}
                                className={cn(
                                  'group/sort inline-flex max-w-full cursor-pointer items-center gap-1.5 uppercase hover:text-foreground',
                                  sorted && 'text-foreground',
                                )}
                              >
                                <span className="truncate">{column.header}</span>
                                <SortIcon sorted={sorted} />
                              </button>
                            ) : (
                              column.header
                            ))}
                        </span>
                        {canResizeColumn && (
                          <ColumnResizer
                            label={column.header}
                            width={header.getSize()}
                            min={bounds(column).min}
                            max={bounds(column).max}
                            active={resizing === column.id}
                            onStart={header.getResizeHandler()}
                            onResize={(width) =>
                              table.setColumnSizing((old) => ({ ...old, [column.id]: width }))
                            }
                            onReset={() => header.column.resetSize()}
                          />
                        )}
                      </th>
                    )
                  }),
                  <th key="filler" aria-hidden className={cn(listTable.th, 'p-0')} />,
                )}
              </tr>
            ))}
          </thead>
          <tbody ref={tbody}>
            {spacer(slice.before, 'before')}
            {slice.rows.map((row) => {
              const original = row.original
              const extra = rowProps?.(original)
              const tr = (
                <tr
                  key={row.id}
                  aria-rowindex={virtual ? row.index + 2 : undefined}
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
                  {withFiller(
                    row.getVisibleCells().map((cell) => {
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
                            column.id === ACTIONS && listTable.menu,
                            filler && column.id === lastColumn && column.id !== ACTIONS && 'pr-5',
                            column.className,
                          )}
                        >
                          {column.cell(original)}
                        </td>
                      )
                    }),
                    <td key="filler" aria-hidden className="p-0" />,
                  )}
                </tr>
              )
              return renderRow ? (
                <WrappedRow key={row.id}>{renderRow(original, tr)}</WrappedRow>
              ) : (
                tr
              )
            })}
            {spacer(slice.after, 'after')}
          </tbody>
        </table>
      </div>
      {footer}
      {pagination && <Pager table={table} />}
    </div>
  )
}

/** Gives a wrapped row (its context menu) a key without adding markup. */
function WrappedRow({ children }: { children: ReactNode }) {
  return children
}

/** Up and down arrows while unsorted (faint), then the arrow and bars of the sorted direction. */
function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  const Icon = { asc: ArrowUpNarrowWide, desc: ArrowDownWideNarrow, none: ArrowUpDown }[
    sorted || 'none'
  ]
  return (
    <Icon
      aria-hidden
      data-sort={sorted || 'none'}
      className={cn(
        // Still on hover: the arrow nudge every other button's arrow icon has would read as motion.
        'size-3.5 shrink-0 animate-none! transition-none! duration-0!',
        sorted
          ? 'text-foreground'
          : 'text-muted-foreground/50 group-hover/sort:text-muted-foreground',
      )}
    />
  )
}

/**
 * The widths of the shown columns: stored ones as they are, the others at their default; what
 * the box has beyond that goes to the resizable ones without a stored width, in proportion to
 * their default (the flexible one counts twice), so no column soaks up all of it. Short of room,
 * the flexible one gives up width down to its minimum.
 */
export function fitColumns<T>(
  shown: readonly DataColumn<T>[],
  sizes: ColumnSizingState,
  available: number,
): ColumnSizingState {
  const width = (column: DataColumn<T>) => {
    const { size, min, max } = bounds(column)
    return clamp(sizes[column.id] ?? size, min, max)
  }
  const used = shown.reduce((sum, column) => sum + width(column), 0)
  const growing = shown.filter((column) => canResize(column) && !(column.id in sizes))
  if (growing.length === 0) return sizes
  const extra = available - used
  const flex = growing.find((column) => column.flex)
  const fitted = new Map(growing.map((column) => [column.id, width(column)]))
  if (extra < 0 && flex) fitted.set(flex.id, Math.max(bounds(flex).min, width(flex) + extra))
  if (extra > 0) {
    const weight = (column: DataColumn<T>) => width(column) * (column.flex ? 2 : 1)
    const weights = growing.reduce((sum, column) => sum + weight(column), 0)
    for (const column of growing)
      fitted.set(column.id, width(column) + Math.floor((extra * weight(column)) / weights))
    // What rounding down left over goes to the flexible column, else the first one.
    const rest =
      available - used - growing.reduce((sum, c) => sum + (fitted.get(c.id) ?? 0) - width(c), 0)
    const last = flex ?? growing[0]
    if (last) fitted.set(last.id, (fitted.get(last.id) ?? 0) + rest)
    for (const column of growing) {
      const { min, max } = bounds(column)
      fitted.set(column.id, clamp(fitted.get(column.id) ?? 0, min, max))
    }
  }
  return { ...sizes, ...Object.fromEntries(fitted) }
}

/**
 * A column's right edge, as in TanStack's resizing example: a thin bar that TanStack's handler
 * drags on mouse and touch (it follows the pointer on the document until release); a double-click
 * gives the column its default width again. A button, so it is focusable: the arrow keys resize in
 * steps (Shift: bigger ones), Enter resets.
 */
function ColumnResizer({
  label,
  width,
  min,
  max,
  active,
  onStart,
  onResize,
  onReset,
}: {
  label: string
  width: number
  min: number
  max: number
  active: boolean
  onStart: (event: unknown) => void
  onResize: (width: number) => void
  onReset: () => void
}) {
  return (
    <button
      type="button"
      aria-label={translate('tableResizeColumn', { column: label })}
      data-column-resizer=""
      data-resizing={active || undefined}
      onMouseDown={onStart}
      onTouchStart={onStart}
      onDoubleClick={onReset}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event: KeyboardEvent) => {
        const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
        if (event.key === 'Enter') onReset()
        else if (direction)
          onResize(clamp(width + direction * (event.shiftKey ? STEP * 4 : STEP), min, max))
        else return
        event.preventDefault()
      }}
      // Inside its own header: centred on the border, the next sticky header would cover its half.
      className="group/resizer absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize touch-none justify-end outline-none select-none"
    >
      <span className="my-2.5 border-r border-dashed border-border group-hover/resizer:border-solid group-hover/resizer:border-foreground group-focus-visible/resizer:border-solid group-focus-visible/resizer:border-foreground group-data-resizing/resizer:border-solid group-data-resizing/resizer:border-foreground" />
    </button>
  )
}

/**
 * The columns of a list's Customize menu: each shown or hidden (`required` ones always show) and
 * moved up or down, in the order its table shows them (the same stored order); Reset gives back
 * the default order. The checkbox and row menu columns are not listed: they never move.
 */
export function ColumnsCustomize({
  table,
  columns,
  hidden,
  onToggle,
}: {
  /** The table's `id`. */
  table: string
  columns: readonly { id: string; label: string; required?: boolean }[]
  hidden: readonly string[]
  onToggle: (column: string) => void
}) {
  const listed = columns.filter((column) => !isFixed(column.id))
  const byId = new Map(listed.map((column) => [column.id, column]))
  const { order, customised, setOrder } = useColumnOrder(
    table,
    listed.map((column) => column.id),
  )
  const move = (from: number, to: number) => {
    const next = [...order]
    const [column] = next.splice(from, 1)
    if (column === undefined) return
    next.splice(to, 0, column)
    setOrder(next)
  }
  return (
    <>
      <ul>
        {order.map((id, index) => {
          const column = byId.get(id)
          if (!column) return null
          return (
            <li
              key={id}
              className="flex h-8 items-center gap-0.5 rounded-md pr-1 pl-2 text-sm hover:bg-muted"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={column.required || !hidden.includes(id)}
                  disabled={column.required}
                  onCheckedChange={() => onToggle(id)}
                />
                <span className="truncate">{column.label}</span>
              </label>
              <IconButton
                size="icon-xs"
                label={translate('tableMoveColumnUp', { column: column.label })}
                icon={ChevronUp}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              />
              <IconButton
                size="icon-xs"
                label={translate('tableMoveColumnDown', { column: column.label })}
                icon={ChevronDown}
                disabled={index === order.length - 1}
                onClick={() => move(index, index + 1)}
              />
            </li>
          )
        })}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start font-normal"
        disabled={!customised}
        onClick={() => setOrder(null)}
      >
        <RotateCcw />
        {translate('tableResetColumns')}
      </Button>
    </>
  )
}

type PagerTable = {
  state: { pagination: PaginationState }
  getPageCount: () => number
  getRowCount: () => number
  getCanPreviousPage: () => boolean
  getCanNextPage: () => boolean
  firstPage: () => void
  previousPage: () => void
  nextPage: () => void
  lastPage: () => void
  setPageIndex: (index: number) => void
  setPageSize: (size: number) => void
}

function IconButton({
  label,
  icon: Icon,
  disabled,
  onClick,
  className,
  size = 'icon-sm',
}: {
  label: string
  icon: LucideIcon
  disabled: boolean
  onClick: () => void
  className?: string
  size?: 'icon-sm' | 'icon-xs'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={className}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Under a paged list, driven by TanStack's pagination: the rows shown on the left; rows per page,
 * first, previous, the pages (1 … 4 5 6 … 20), next and last on the right. With one page only the
 * count and rows per page are left (a smaller size could make pages again), and nothing at all when
 * every row fits the smallest size. Phones keep the count, previous, "2 / 7" and next.
 */
function Pager({ table }: { table: PagerTable }) {
  const { pageIndex, pageSize } = table.state.pagination
  const pages = Math.max(table.getPageCount(), 1)
  const total = table.getRowCount()
  const page = pageIndex + 1
  if (pages < 2 && total <= PAGE_SIZES[0]) return null
  return (
    <nav
      aria-label={translate('tablePages')}
      className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-2 text-body-sm text-muted-foreground md:px-5"
    >
      <span className="tabular-nums">
        {translate('tableRange', {
          from: total ? pageIndex * pageSize + 1 : 0,
          to: Math.min(page * pageSize, total),
          total,
        })}
      </span>
      <span className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="font-normal text-muted-foreground tabular-nums max-sm:hidden"
            >
              {translate('tableRowsPerPage', { count: pageSize })}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={String(pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              {PAGE_SIZES.map((size) => (
                <DropdownMenuRadioItem key={size} value={String(size)}>
                  {size}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {pages > 1 && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border max-sm:hidden" />
            <IconButton
              label={translate('tableFirstPage')}
              icon={ChevronsLeft}
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.firstPage()}
              className="max-sm:hidden"
            />
            <IconButton
              label={translate('tablePreviousPage')}
              icon={ChevronLeft}
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            />
            <span className="px-1 text-foreground tabular-nums sm:hidden">
              <span aria-hidden>
                {page} / {pages}
              </span>
              <span className="sr-only">{translate('tablePageOf', { page, pages })}</span>
            </span>
            <span className="flex items-center gap-0.5 max-sm:hidden">
              {pageItems(page, pages).map((item) =>
                typeof item === 'string' ? (
                  <span key={item} aria-hidden className="w-7 text-center">
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    variant={item === page ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-label={translate('tablePage', { page: item })}
                    aria-current={item === page ? 'page' : undefined}
                    onClick={() => table.setPageIndex(item - 1)}
                    className={cn(
                      'min-w-7 px-1.5 tabular-nums',
                      item === page ? 'text-foreground' : 'font-normal text-muted-foreground',
                    )}
                  >
                    {item}
                  </Button>
                ),
              )}
            </span>
            <IconButton
              label={translate('tableNextPage')}
              icon={ChevronRight}
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            />
            <IconButton
              label={translate('tableLastPage')}
              icon={ChevronsRight}
              disabled={!table.getCanNextPage()}
              onClick={() => table.lastPage()}
              className="max-sm:hidden"
            />
          </>
        )}
      </span>
    </nav>
  )
}
