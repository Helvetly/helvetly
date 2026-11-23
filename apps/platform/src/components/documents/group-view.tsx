'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { ContextMenu, ContextMenuTrigger } from '@helvetly/ui/components/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Download, FolderOpen, Layers } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatSize, groupLabel, type DocGroup, type GroupDim } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { FolderArt, FolderMark } from './folder-art'

type Props = {
  dim: GroupDim
  groups: DocGroup[]
  layout: 'grid' | 'list'
  onOpen: (group: DocGroup) => void
  onDownload: (group: DocGroup) => void
}

const files = (group: DocGroup) =>
  `${translate('groupFiles', { count: group.count })} · ${formatSize(group.size)}`

/** The small mark that tells a virtual folder from a real one: it is a view, nothing sits in it. */
export function ViewGlyph({ className }: { className?: string }) {
  const tip = translate('groupViewTip')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-hidden
          data-view-glyph
          className={cn(
            'flex size-5 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border',
            className,
          )}
        >
          <Layers className="size-3 stroke-[1.75]" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{tip}</TooltipContent>
    </Tooltip>
  )
}

/** One level of a grouped view: its groups as folders (grid or list), opened by a click, downloaded from the menu. */
export function GroupView({ dim, groups, layout, onOpen, onDownload }: Props) {
  const menu = (group: DocGroup, children: ReactNode) => (
    <ContextMenu key={group.key}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ActionMenuContent
        kind="context"
        menu={{
          header: groupLabel(dim, group),
          actions: [
            {
              id: 'open',
              group: 'view',
              icon: <FolderOpen />,
              label: translate('open'),
              onSelect: () => onOpen(group),
            },
            {
              id: 'zip',
              group: 'view',
              icon: <Download />,
              label: translate('downloadAllZip'),
              onSelect: () => onDownload(group),
            },
          ],
        }}
      />
    </ContextMenu>
  )
  if (layout === 'list')
    return (
      <ul aria-label={translate('groupViewTip')} className="grid p-2 md:p-3">
        {groups.map((group) =>
          menu(
            group,
            <li>
              <button
                type="button"
                onClick={() => onOpen(group)}
                className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-foreground/[0.05]"
              >
                <FolderMark className="size-5" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {groupLabel(dim, group)}
                </span>
                <ViewGlyph />
                <span className="w-36 shrink-0 text-right text-body-sm text-muted-foreground tabular-nums max-sm:hidden">
                  {files(group)}
                </span>
              </button>
            </li>,
          ),
        )}
      </ul>
    )
  return (
    <div className="@container p-4 md:p-5">
      <ul
        aria-label={translate('groupViewTip')}
        className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-x-2 gap-y-3 @2xl:grid-cols-[repeat(auto-fill,minmax(132px,1fr))]"
      >
        {groups.map((group) =>
          menu(
            group,
            <li className="relative">
              <button
                type="button"
                onClick={() => onOpen(group)}
                title={files(group)}
                className="flex w-full cursor-pointer flex-col items-center gap-2.5 rounded-2xl px-2 pt-3 pb-3 outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-foreground/[0.05]"
              >
                <span className="relative flex aspect-[5/4] w-16 items-center justify-center @2xl:w-[90px]">
                  <FolderArt full={group.count > 0} className="w-14 @2xl:w-[78px]" />
                  <ViewGlyph className="absolute right-0 bottom-0" />
                </span>
                <span className="block w-full min-w-0 text-center">
                  <span className="block truncate text-body font-medium">
                    {groupLabel(dim, group)}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {translate('groupFiles', { count: group.count })}
                  </span>
                </span>
              </button>
            </li>,
          ),
        )}
      </ul>
    </div>
  )
}
