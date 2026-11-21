'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Lock, RotateCcw, Trash2 } from 'lucide-react'
import { useSearchParams, usePathname } from 'next/navigation'
import { useMemo, type ReactNode } from 'react'

import { listTable } from '@/components/data/list-table'
import { LoadProblem } from '@/components/data/load-problem'
import {
  ResizableHead,
  ResizableTable,
  useResizableColumns,
} from '@/components/data/resizable-columns'
import { ariaSort, SortButton } from '@/components/data/sort-header'
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
  const widths = useResizableColumns('trash', ['name', 'was', 'deleted', 'size'], { flex: 'name' })
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
  const header = (field: TrashSortField, label: string) => (
    <SortButton
      label={label}
      sorted={sort.field === field}
      desc={sort.desc}
      onClick={() => sortBy(field)}
    />
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
  const all = items.every((item) => selected.has(item.id))
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
      <ResizableTable columns={widths} className={listTable.table}>
        <thead>
          <tr className={listTable.head}>
            <th className={listTable.select}>
              <Checkbox
                aria-label={translate('selectEverythingInTheTrash')}
                checked={all}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </th>
            <ResizableHead
              columns={widths}
              column="name"
              label={translate('name')}
              className={listTable.th}
              aria-sort={ariaSort(sort.field === 'name', sort.desc)}
            >
              {header('name', translate('name'))}
            </ResizableHead>
            <ResizableHead
              columns={widths}
              column="was"
              label={translate('wasIn')}
              className={cn(listTable.th, 'hidden w-[18%] @4xl:table-cell')}
              aria-sort={ariaSort(sort.field === 'was', sort.desc)}
            >
              {header('was', translate('wasIn'))}
            </ResizableHead>
            <ResizableHead
              columns={widths}
              column="deleted"
              label={translate('deleted2')}
              className={cn(listTable.th, 'hidden w-[18%] @5xl:table-cell')}
              aria-sort={ariaSort(sort.field === 'deleted', sort.desc)}
            >
              {header('deleted', translate('deleted2'))}
            </ResizableHead>
            <ResizableHead
              columns={widths}
              column="size"
              label={translate('size')}
              className={cn(listTable.th, listTable.numeric, 'w-[10%]')}
              aria-sort={ariaSort(sort.field === 'size', sort.desc)}
            >
              {header('size', translate('size'))}
            </ResizableHead>
            <th
              className={cn(listTable.th, 'w-[150px]')}
              aria-sort={ariaSort(sort.field === 'purge', sort.desc)}
            >
              {header('purge', translate('deletedForGood'))}
            </th>
            <th className="w-[92px] pr-3">
              <span className="sr-only">{translate('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const left = daysLeft(item.purge_at)
            const kept = isRetained(item.retained_until)
            return (
              <tr
                key={item.id}
                data-selected={selected.has(item.id) || undefined}
                onDoubleClick={() => onOpen(item)}
                className={cn(listTable.row, 'group/row')}
              >
                <td className={listTable.select}>
                  <Checkbox
                    aria-label={translate('select', { name: item.name })}
                    checked={selected.has(item.id)}
                    onCheckedChange={() => onToggle(item)}
                  />
                </td>
                <td className="px-3">
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
                </td>
                <td className="hidden px-3 text-muted-foreground @4xl:table-cell">
                  <span className="block truncate">
                    {item.location ? folderLabel(item.location) : translate('allDocuments')}
                  </span>
                </td>
                <td className="hidden px-3 text-muted-foreground @5xl:table-cell">
                  <span className="block truncate">
                    {formatDate(item.deleted_at)}
                    {item.deleted_by?.name ? ` · ${item.deleted_by.name}` : ''}
                  </span>
                </td>
                <td className={cn(listTable.td, listTable.numeric, 'text-muted-foreground')}>
                  {formatSize(item.size)}
                </td>
                <td className="px-3">
                  {kept ? (
                    <span className="inline-flex h-6 items-center gap-1 rounded-[4px] bg-[#ece9d5] px-1.5 text-[13px] text-[#675d3a] dark:bg-amber-500/15 dark:text-amber-300">
                      <Lock className="size-3" />
                      {translate('kept')}
                    </span>
                  ) : (
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
                  )}
                </td>
                <td className="pr-3">
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
                </td>
              </tr>
            )
          })}
        </tbody>
      </ResizableTable>
    </div>
  )
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
