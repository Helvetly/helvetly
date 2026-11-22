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

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

/** What the workspace stores, split by kind; there is no quota until billing adds one. */
export function StorageOverview({ usage, onTrash }: { usage: Usage; onTrash: () => void }) {
  return (
    <section
      aria-label={translate('storageOverview')}
      className="grid gap-3.5 border-b px-4 pt-5 pb-5 md:px-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-medium">{translate('storageOverview')}</h2>
        <p className="text-[13px] text-muted-foreground">
          {translate('youVeUsed')}{' '}
          <span className="font-medium text-foreground tabular-nums">{formatSize(usage.size)}</span>{' '}
          {translate('across')}
          {files(usage.files)}.
        </p>
      </div>
      {/* The legend below says the same in words. */}
      <div aria-hidden className="flex h-5 overflow-hidden rounded-[7px] bg-muted dark:bg-muted/60">
        {usage.by_kind.map((share) => (
          <span
            key={share.kind}
            title={`${SHARE_LABELS[share.kind]}: ${files(share.files)}, ${formatSize(share.size)}`}
            data-kind={share.kind}
            className={cn(
              // A thin seam in the page colour keeps neighbours apart.
              'min-w-1.5 border-r border-card last:border-r-0',
              KIND_STYLE[share.kind].bar,
            )}
            style={{ flexGrow: share.size || 1 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
        {usage.by_kind.map((share) => (
          <li key={share.kind} className="flex items-center gap-1.5">
            <span
              data-kind={share.kind}
              className={cn('size-2 rounded-full', KIND_STYLE[share.kind].bar)}
            />
            <span className="text-muted-foreground">{SHARE_LABELS[share.kind]}</span>
            <span className="font-medium tabular-nums">{formatSize(share.size)}</span>
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
