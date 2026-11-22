'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { DataTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Lock, RotateCcw, Trash2 } from 'lucide-react'
import { useSearchParams, usePathname } from 'next/navigation'
import { useMemo, type ReactNode } from 'react'

import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import {
  daysLeft,
  DEFAULT_TRASH_SORT,
  formatSize,
  isRetained,
  TRASH_SORTS,
  trashSortValue,
  type TrashItem,
  type TrashSortField,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { nextSort, parseSort, sortParam, sortRows } from '@/lib/list-sort'
import { useCan } from '@/lib/permissions'
import { folderLabel } from '@/lib/system-folders'
import { setUrlQuery } from '@/lib/url-query'

import { FolderMark } from './folder-art'
import { KindIcon, kindOfType } from './kind'

/** The Trash: what was deleted, from where, and how long it stays restorable. */
export function TrashView({
  items,
  error,
  onRetry,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onRestore,
  onDelete,
  onEmpty,
  canDelete,
}: {
  items: TrashItem[] | undefined
  error: unknown
  onRetry: () => void
  selected: ReadonlySet<string>
  onToggle: (item: TrashItem) => void
  onToggleAll: (all: boolean) => void
  onOpen: (item: TrashItem) => void
  onRestore: (items: TrashItem[]) => void
  onDelete: (items: TrashItem[]) => void
  onEmpty: () => void
  canDelete: boolean
}) {
  const canWrite = useCan('write:documents')
  const pathname = usePathname()
  const query = useSearchParams()
  const sort = parseSort(query.get('sort'), TRASH_SORTS, DEFAULT_TRASH_SORT)
  const rows = useMemo(
    () => sortRows(items ?? [], (item) => trashSortValue(item, sort.field), sort.desc),
    [items, sort.field, sort.desc],
  )
  const sortBy = (field: TrashSortField) => {
    const next = new URLSearchParams(query)
    const value = sortParam(
      nextSort(sort, field, field === 'deleted' || field === 'size'),
      DEFAULT_TRASH_SORT,
    )
    if (value) next.set('sort', value)
    else next.delete('sort')
    setUrlQuery(pathname, next)
  }
  const all = (items ?? []).every((item) => selected.has(item.id))
  const columns = useMemo(
    () =>
      trashColumns({
        all,
        selected,
        canWrite,
        canDelete,
        onToggle,
        onToggleAll,
        onOpen,
        onRestore,
        onDelete,
      }),
    [all, selected, canWrite, canDelete, onToggle, onToggleAll, onOpen, onRestore, onDelete],
  )
  if (error) return <LoadProblem error={error} what={translate('theTrash')} onRetry={onRetry} />
  if (!items) return <LoadingRows />
  if (items.length === 0)
    return (
      <State
        icon={<Trash2 />}
        title={translate('theTrashIsEmpty')}
        text={translate('deletedFilesAndFoldersStayHereFor30Days')}
        action={null}
      />
    )
  return (
    <div className="grid content-start">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[13px] text-muted-foreground">
        <span className="flex-1">{translate('itemsAreDeletedForGood30DaysAfterThey')}</span>
        {canDelete && (
          <Button
            size="sm"
            variant="destructive-ghost"
            className="cursor-pointer"
            onClick={onEmpty}
          >
            <Trash2 />
            {translate('emptyTrash2')}
          </Button>
        )}
      </div>
      <DataTable
        id="trash"
        columns={columns}
        data={rows}
        getRowId={(item) => item.id}
        sorting={{
          column: sort.field,
          desc: sort.desc,
          onSort: (column) => {
            const field = TRASH_SORTS.find((entry) => entry === column)
            if (field) sortBy(field)
          },
        }}
        rowProps={(item) => ({
          'data-selected': selected.has(item.id) || undefined,
          onDoubleClick: () => onOpen(item),
          className: 'group/row',
        })}
      />
    </div>
  )
}

type TrashColumnsInput = {
  all: boolean
  selected: ReadonlySet<string>
  canWrite: boolean
  canDelete: boolean
  onToggle: (item: TrashItem) => void
  onToggleAll: (all: boolean) => void
  onOpen: (item: TrashItem) => void
  onRestore: (items: TrashItem[]) => void
  onDelete: (items: TrashItem[]) => void
}

function trashColumns({
  all,
  selected,
  canWrite,
  canDelete,
  onToggle,
  onToggleAll,
  onOpen,
  onRestore,
  onDelete,
}: TrashColumnsInput): DataColumn<TrashItem>[] {
  return [
    {
      id: 'select',
      header: translate('selectEverythingInTheTrash'),
      headerContent: (
        <Checkbox
          aria-label={translate('selectEverythingInTheTrash')}
          checked={all}
          onCheckedChange={(checked) => onToggleAll(checked === true)}
        />
      ),
      size: 40,
      minSize: 40,
      resizable: false,
      cell: (item) => (
        <Checkbox
          aria-label={translate('select', { name: item.name })}
          checked={selected.has(item.id)}
          onCheckedChange={() => onToggle(item)}
        />
      ),
    },
    {
      id: 'name',
      header: translate('name'),
      flex: true,
      sortable: true,
      cell: (item) => (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 text-left"
        >
          {item.type === 'folder' ? (
            <span className="flex size-7 shrink-0 items-center justify-center">
              <FolderMark className="size-5" />
            </span>
          ) : (
            <KindIcon kind={kindOfType(item.content_type)} />
          )}
          <span className="min-w-0">
            <span className="block truncate">{item.name}</span>
            {item.type === 'folder' && (
              <span className="block text-[12px] text-muted-foreground">
                {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
                {translate('inside')}
              </span>
            )}
          </span>
        </button>
      ),
    },
    {
      id: 'was',
      header: translate('wasIn'),
      size: 180,
      minSize: 100,
      sortable: true,
      showFrom: 850,
      className: 'text-muted-foreground',
      cell: (item) => (
        <span className="block truncate">
          {item.location ? folderLabel(item.location) : translate('allDocuments')}
        </span>
      ),
    },
    {
      id: 'deleted',
      header: translate('deleted2'),
      size: 180,
      minSize: 120,
      sortable: true,
      showFrom: 970,
      className: 'text-muted-foreground',
      cell: (item) => (
        <span className="block truncate">
          {formatDate(item.deleted_at)}
          {item.deleted_by?.name ? ` · ${item.deleted_by.name}` : ''}
        </span>
      ),
    },
    {
      id: 'size',
      header: translate('size'),
      size: 96,
      minSize: 72,
      sortable: true,
      align: 'right',
      className: 'text-muted-foreground',
      cell: (item) => formatSize(item.size),
    },
    {
      id: 'purge',
      header: translate('deletedForGood'),
      size: 150,
      resizable: false,
      sortable: true,
      cell: (item) => {
        if (isRetained(item.retained_until))
          return (
            <span className="inline-flex h-6 items-center gap-1 rounded-[4px] bg-[#ece9d5] px-1.5 text-[13px] text-[#675d3a] dark:bg-amber-500/15 dark:text-amber-300">
              <Lock className="size-3" />
              {translate('kept')}
            </span>
          )
        const left = daysLeft(item.purge_at)
        return (
          <span
            className={cn(
              'inline-flex h-6 items-center rounded-[4px] px-1.5 text-[13px] tabular-nums',
              left <= 3
                ? 'bg-[#f4e0e0] text-[#884848] dark:bg-rose-500/15 dark:text-rose-300'
                : 'bg-[#ededed] text-[#626266] dark:bg-muted dark:text-muted-foreground',
            )}
          >
            {left === 0
              ? translate('today')
              : translate('in3', { left: left, value2: left === 1 ? 'day' : 'days' })}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      size: 92,
      resizable: false,
      cell: (item) => (
        <span className="flex justify-end gap-0.5">
          {canWrite && (
            <RowAction label={translate('restore')} onClick={() => onRestore([item])}>
              <RotateCcw />
            </RowAction>
          )}
          {canDelete && (
            <RowAction
              label={translate('deleteForever')}
              destructive
              onClick={() => onDelete([item])}
            >
              <Trash2 />
            </RowAction>
          )}
        </span>
      ),
    },
  ]
}

function RowAction({
  label,
  destructive,
  onClick,
  children,
}: {
  label: string
  destructive?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={destructive ? 'destructive-ghost' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          className={cn('cursor-pointer', !destructive && 'text-muted-foreground')}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
