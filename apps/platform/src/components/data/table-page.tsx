'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import type { UseQueryResult } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  CloudOff,
  Ellipsis,
  ListFilter,
  SearchX,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useCanWriteHere } from '@/lib/permissions'

import { listTable } from './list-table'
import { ListSearch, ListToolbar } from './list-toolbar'
import { DetailsPopover, DetailsSheet, type RowDetails } from './row-details'

export type Column<Row> = {
  header: string
  cell: (row: Row) => ReactNode
  /** A Tailwind width, e.g. "w-[28%]": fixed proportions keep big screens tidy. */
  width: string
  align?: 'right'
  /** Only on wide screens, where there is room for it. */
  wide?: boolean
}

/** A row on phones: two lines on the left, value and status on the right. */
export type RowLine = { title: string; subtitle: string; value?: string; status?: ReactNode }

type View<Row> = { label: string; filter?: (row: Row) => boolean }

const soon = (what: string) => () => toast(translate('comingSoon', { what: what }))

const matches = (row: object, query: string) =>
  Object.values(row).join(' ').toLowerCase().includes(query.trim().toLowerCase())

/** A list page as in the reference: views, key figures, toolbar, table, bulk actions. */
export function TablePage<Row extends { id: string }>({
  views,
  primary,
  noun,
  query,
  kpis,
  columns,
  line,
  details,
}: {
  views: View<Row>[]
  /** The page's create action, e.g. "New invoice". */
  primary: string
  /** Plural, lower case, e.g. "invoices". */
  noun: string
  query: UseQueryResult<Row[]>
  kpis?: ReactNode
  columns: Column<Row>[]
  line: (row: Row) => RowLine
  details: (row: Row) => RowDetails
}) {
  const [viewIndex, setViewIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [sheet, setSheet] = useState<RowDetails | null>(null)
  const filter = views[viewIndex]?.filter
  const rows = (query.data ?? []).filter((row) => (!filter || filter(row)) && matches(row, search))
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const [first, ...rest] = columns

  return (
    <>
      <PageHeader
        tabs={views.map((view) => view.label)}
        active={viewIndex}
        onSelect={setViewIndex}
        primary={primary}
      />
      {kpis}
      <div className="relative flex flex-1 flex-col">
        <ListToolbar>
          <Button
            variant="ghost"
            size="sm"
            className="text-title-sm font-normal"
            onClick={soon(translate('filtersAre'))}
          >
            <ListFilter className="stroke-[1.5]" />
            {translate('filters')}
          </Button>
          <ListSearch
            label={translate('search2', { noun: noun })}
            placeholder={translate('search')}
            value={search}
            onChange={setSearch}
          />
          <Button
            variant="ghost"
            size="sm"
            className="text-title-sm font-normal"
            onClick={soon(translate('customColumnsAre'))}
          >
            <SlidersHorizontal className="stroke-[1.5]" />
            <span className="max-sm:sr-only">{translate('customize')}</span>
          </Button>
        </ListToolbar>

        {query.error ? (
          <State
            icon={<CloudOff />}
            title={translate('couldnTLoad', { noun: noun })}
            text={errorMessage(query.error)}
            action={
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {translate('tryAgain')}
              </Button>
            }
          />
        ) : !query.data ? (
          <LoadingRows />
        ) : (
          <>
            <table className={cn(listTable.table, 'hidden xl:table')}>
              <thead>
                <tr className={listTable.head}>
                  <th className={listTable.select}>
                    <Checkbox
                      aria-label={translate('selectAll2', { noun: noun })}
                      className="bg-card"
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setSelected(new Set(checked ? rows.map((row) => row.id) : []))
                      }
                    />
                  </th>
                  {first && (
                    <th className={cn(listTable.th, 'text-foreground', first.width)}>
                      <span className="inline-flex items-center gap-1">
                        {first.header} <ChevronDown className="size-3.5" />
                      </span>
                    </th>
                  )}
                  {rest.map((column) => (
                    <th
                      key={column.header}
                      className={cn(
                        listTable.th,
                        column.width,
                        column.align === 'right' && listTable.numeric,
                        column.wide && 'hidden 2xl:table-cell',
                      )}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-selected={selected.has(row.id) || undefined}
                    className={listTable.row}
                  >
                    <td className={listTable.select}>
                      <Checkbox
                        aria-label={translate('select2', { title: line(row).title })}
                        className="bg-card"
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                      />
                    </td>
                    {first && (
                      <td className={listTable.td}>
                        <DetailsPopover details={details(row)}>{first.cell(row)}</DetailsPopover>
                      </td>
                    )}
                    {rest.map((column) => (
                      <td
                        key={column.header}
                        className={cn(
                          listTable.td,
                          column.align === 'right' && listTable.numeric,
                          column.wide && 'hidden 2xl:table-cell',
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className={cn(listTable.list, 'xl:hidden')}>
              {rows.map((row) => {
                const { title, subtitle, value, status } = line(row)
                return (
                  <li
                    key={row.id}
                    data-selected={selected.has(row.id) || undefined}
                    className={listTable.item}
                  >
                    <Checkbox
                      aria-label={translate('select2', { title: title })}
                      className="bg-card"
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                    <button
                      type="button"
                      onClick={() => setSheet(details(row))}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="grid min-w-0 flex-1 leading-snug">
                        <span className="truncate text-[15px]">{title}</span>
                        <span className="truncate text-[13px] text-muted-foreground">
                          {subtitle}
                        </span>
                      </span>
                      <span className="grid shrink-0 justify-items-end gap-1">
                        {value && <span className="text-[14px] tabular-nums">{value}</span>}
                        {status}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {rows.length === 0 && (
              <State
                icon={<SearchX />}
                title={
                  search
                    ? translate('nothingMatches', { search: search })
                    : translate('noInThisView', { noun: noun })
                }
                text={search ? translate('tryAnotherWord') : translate('pickAnotherViewToSeeMore')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setViewIndex(0)
                    }}
                  >
                    {translate('showAll')}
                    {noun}
                  </Button>
                }
              />
            )}
          </>
        )}

        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            actions={[
              {
                label: translate('export'),
                icon: <Upload />,
                onClick: soon(translate('exportingIs', { noun: noun })),
              },
              {
                label: translate('archive'),
                icon: <Archive />,
                onClick: soon(translate('archivingIs', { noun: noun })),
              },
              {
                label: translate('delete3'),
                icon: <Trash2 />,
                onClick: soon(translate('deletingIs', { noun: noun })),
                destructive: true,
              },
              {
                label: translate('more'),
                icon: <Ellipsis />,
                onClick: soon(translate('moreActionsAre')),
              },
            ]}
          />
        )}
      </div>
      <DetailsSheet details={sheet} onClose={() => setSheet(null)} />
    </>
  )
}

const bulkIcon =
  'flex size-8 items-center justify-center rounded-md text-white/85 transition-colors duration-150 hover:bg-white/10 hover:text-white [&_svg]:size-[18px] [&_svg]:stroke-[1.6]'

// The bar is always dark, so the light theme's red would be too dim on it.
const bulkDestructive = 'text-red-400 hover:bg-red-500/15 hover:text-red-300'

function Divider() {
  return <span aria-hidden className="h-4 w-px bg-white/20" />
}

export type BulkAction = {
  label: string
  icon: ReactNode
  onClick: () => void
  /** Goes last, in red, in a row's right-click menu. */
  destructive?: boolean
  /** Changes records: hidden from a member without write on the page's resource. */
  write?: boolean
  /** Why the action cannot run now: shown in its tooltip, the button stays focusable. */
  disabled?: string
}

/** The floating dark bar while rows are selected: the count, then the actions as icon buttons. */
export function BulkBar({
  count,
  actions,
  onClear,
}: {
  count: number
  actions: BulkAction[]
  onClear: () => void
}) {
  const writable = useCanWriteHere()
  return (
    <div className="pointer-events-none sticky bottom-5 z-30 mt-auto flex animate-in justify-center gap-2 px-4 pt-6 duration-200 fade-in slide-in-from-bottom-2">
      <button
        type="button"
        aria-label={translate('clearSelection')}
        onClick={onClear}
        className="pointer-events-auto flex size-11 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-elevation-2 transition-colors duration-150 hover:bg-zinc-800 dark:bg-zinc-800"
      >
        <X className="size-[18px]" />
      </button>
      <div
        role="toolbar"
        aria-label={translate('selectedRows')}
        className="pointer-events-auto flex h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-[15px] text-white shadow-elevation-2 dark:bg-zinc-800"
      >
        <span className="pr-1 whitespace-nowrap tabular-nums">
          {translate('selected')}
          {count}
        </span>
        {actions
          .filter((action) => writable || !action.write)
          .map(({ label, icon, onClick, destructive, disabled }) => (
            <span key={label} className="contents">
              <Divider />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-disabled={Boolean(disabled)}
                    className={cn(
                      bulkIcon,
                      destructive && bulkDestructive,
                      disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                    )}
                    onClick={disabled ? undefined : onClick}
                  >
                    {icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-pretty">
                  {disabled ? `${label}: ${disabled}` : label}
                </TooltipContent>
              </Tooltip>
            </span>
          ))}
      </div>
    </div>
  )
}

export function State({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode
  title: string
  text: string
  action: ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="grid max-w-sm animate-in justify-items-center text-center duration-300 fade-in slide-in-from-bottom-1">
        <div aria-hidden className="relative mb-7 h-24 w-48">
          <div className="absolute -inset-x-14 -inset-y-10 bg-[radial-gradient(var(--border)_1px,transparent_1px)] mask-[radial-gradient(closest-side,black,transparent)] bg-size-[14px_14px]" />
          <GhostCard className="top-3 left-0 -rotate-[8deg]" />
          <GhostCard className="top-3 right-0 rotate-[8deg]" />
          <span className="absolute top-1/2 left-1/2 flex size-14 -translate-1/2 items-center justify-center rounded-2xl bg-card text-foreground shadow-[0_10px_30px_-8px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-foreground/10 [&_svg]:size-6 [&_svg]:stroke-[1.5]">
            {icon}
          </span>
        </div>
        <p className="text-[17px] font-medium tracking-[-0.01em] text-balance">{title}</p>
        <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{text}</p>
        <div className="mt-5">{action}</div>
      </div>
    </div>
  )
}

/** A blank record card behind an empty state's icon: a hint of the rows that will appear here. */
function GhostCard({ className }: { className: string }) {
  return (
    <span
      className={cn(
        'absolute grid h-16 w-24 content-center gap-1.5 rounded-xl bg-card px-3 shadow-elevation-1',
        className,
      )}
    >
      <span className="size-3.5 rounded-full bg-muted" />
      <span className="h-1.5 w-14 rounded-full bg-muted" />
      <span className="h-1.5 w-9 rounded-full bg-muted" />
    </span>
  )
}

export function LoadingRows() {
  return <Loader className="min-h-112" />
}
