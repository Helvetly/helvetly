'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Lock, RotateCcw, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import { daysLeft, formatSize, isRetained, type TrashItem } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'

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
      <table className="w-full table-fixed text-[14px]">
        <thead>
          <tr className="h-10 border-b text-left text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
            <th className="w-12 pl-4">
              <Checkbox
                aria-label={translate('selectEverythingInTheTrash')}
                checked={all}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </th>
            <th className="px-3 font-medium">{translate('name')}</th>
            <th className="hidden w-[18%] px-3 font-medium @4xl:table-cell">
              {translate('wasIn')}
            </th>
            <th className="hidden w-[18%] px-3 font-medium @5xl:table-cell">
              {translate('deleted2')}
            </th>
            <th className="w-[10%] px-3 text-right font-medium">{translate('size')}</th>
            <th className="w-[150px] px-3 font-medium">{translate('deletedForGood')}</th>
            <th className="w-[92px] pr-4">
              <span className="sr-only">{translate('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const left = daysLeft(item.purge_at)
            const kept = isRetained(item.retained_until)
            return (
              <tr
                key={item.id}
                data-selected={selected.has(item.id) || undefined}
                onDoubleClick={() => onOpen(item)}
                className="group/row h-12 border-b border-border/70 hover:bg-muted/50 data-selected:bg-primary/[0.06]"
              >
                <td className="pl-4">
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
                    {item.location?.name ?? translate('allDocuments')}
                  </span>
                </td>
                <td className="hidden px-3 text-muted-foreground @5xl:table-cell">
                  <span className="block truncate">
                    {formatDate(item.deleted_at)}
                    {item.deleted_by?.name ? ` · ${item.deleted_by.name}` : ''}
                  </span>
                </td>
                <td className="px-3 text-right text-muted-foreground tabular-nums">
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
                <td className="pr-4">
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
      </table>
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
          className={cn(
            'cursor-pointer',
            !destructive && 'text-muted-foreground hover:text-foreground',
          )}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
