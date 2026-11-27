'use client'
import { cn } from '@helvetly/ui/lib/utils'
import { Trash2 } from 'lucide-react'

import { formatSize, type Kind, type Usage } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { KIND_STYLE } from './kind'

const SHARE_LABELS: Record<Kind, string> = {
  pdf: 'PDFs',
  image: translate('images'),
  spreadsheet: translate('spreadsheets'),
  document: translate('documents'),
  presentation: translate('presentations'),
  text: translate('textFiles'),
  archive: translate('archives'),
  other: translate('other'),
}

const files = (count: number) => translate('groupFiles', { count })

export function StorageOverview({ usage, onTrash }: { usage: Usage; onTrash: () => void }) {
  const used = usage.stored_bytes ?? usage.size
  const capacity = usage.capacity_bytes
  const remaining =
    capacity !== undefined && capacity >= 0 ? Math.max(0, capacity - used) : undefined
  const other = Math.max(0, used - usage.size)
  const segments: { key: string; label: string; size: number; color: string }[] = usage.by_kind.map(
    (share) => ({
      key: share.kind,
      label: SHARE_LABELS[share.kind],
      size: share.size,
      color: KIND_STYLE[share.kind].bar,
    }),
  )
  if (other > 0)
    segments.push({
      key: 'other-storage',
      label: translate('otherUsedStorage'),
      size: other,
      color: 'bg-muted-foreground',
    })
  if (remaining !== undefined)
    segments.push({
      key: 'free',
      label: translate('freeSpace'),
      size: remaining,
      color: 'bg-input',
    })
  return (
    <section
      aria-label={translate('storageOverview')}
      className="grid gap-3.5 border-b px-4 pt-5 pb-5 md:px-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-medium">{translate('storageOverview')}</h2>
        <p className="text-[13px] text-muted-foreground">
          {capacity !== undefined && capacity >= 0
            ? translate('ofUsed', { value1: formatSize(used), value2: formatSize(capacity) })
            : translate('storageUsedBytes', { size: formatSize(used) })}
          {' · '}
          {files(usage.files)}
          {capacity === -1 && translate('unlimited3')}
        </p>
      </div>
      {(used > 0 || (remaining ?? 0) > 0) && (
        <div aria-hidden className="flex h-5 overflow-clip rounded-[7px]">
          {segments.map(({ key, label, size, color }) => (
            <span
              key={key}
              data-kind={key}
              title={`${label}: ${formatSize(size, 3)}`}
              className={cn(color, size > 0 && (used > 0 || key === 'free') && 'min-w-px')}
              style={{
                flexGrow: usage.size > used && key !== 'free' ? size * (used / usage.size) : size,
              }}
            />
          ))}
        </div>
      )}
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
        {segments.map(({ key, label, size, color }) => (
          <li key={key} className="flex items-center gap-1.5">
            <span data-kind={key} className={cn('size-2 rounded-full', color)} />
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">
              {formatSize(size, key === 'free' ? 3 : undefined)}
            </span>
          </li>
        ))}
        {usage.trash.files > 0 && (
          <li className="ml-auto">
            <button
              type="button"
              onClick={onTrash}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Trash2 className="size-3.5 stroke-[1.75]" />
              {translate('trash2')}
              {files(usage.trash.files)} · {formatSize(usage.trash.size)}
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}
