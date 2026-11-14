'use client'

import { ContextMenu, ContextMenuTrigger } from '@helvetly/ui/components/context-menu'
import { formatRelative } from '@helvetly/ui/lib/format'
import type { ReactNode } from 'react'

import { formatSize, type DocFile } from '@/lib/documents'

import { KindIcon } from './kind'
import { MenuButton } from './menu-button'
import { fileKey, type ItemKey } from './selection'
import { Thumbnail } from './thumbnail'

/** The latest uploads from every folder, as compact cards. */
export function RecentStrip({
  files,
  menu,
  onOpen,
}: {
  files: DocFile[]
  menu: (key: ItemKey) => ReactNode
  onOpen: (file: DocFile) => void
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
      {files.map((file) => (
        <li key={file.id}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="group/recent relative flex h-[60px] items-center gap-3 rounded-xl border border-border/80 bg-card pr-1.5 pl-2 transition-colors duration-150 hover:bg-muted/40 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 data-[state=open]:bg-muted/50 dark:bg-muted/20 dark:hover:bg-muted/40">
                {file.previewable ? (
                  <Thumbnail
                    file={file}
                    className="size-11 shrink-0 rounded-lg bg-muted ring-1 ring-border/60 dark:bg-background/50 [&_span]:rounded-none"
                  />
                ) : (
                  <KindIcon kind={file.kind} className="size-11 rounded-lg [&_svg]:size-5" />
                )}
                <button
                  type="button"
                  onClick={() => onOpen(file)}
                  className="min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-xl"
                >
                  <span
                    className="block truncate text-[13.5px] leading-5 font-medium"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {formatSize(file.size)} · {formatRelative(file.created_at)}
                  </span>
                </button>
                <MenuButton label={`Actions for ${file.name}`} />
              </div>
            </ContextMenuTrigger>
            {menu(fileKey(file.id))}
          </ContextMenu>
        </li>
      ))}
    </ul>
  )
}
