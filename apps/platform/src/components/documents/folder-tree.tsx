'use client'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@helvetly/ui/components/context-menu'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ChevronRight,
  Clock,
  FileSignature,
  LayoutTemplate,
  FolderPlus,
  HardDrive,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  childrenOf,
  KIND_LABELS,
  pathTo,
  type Folder,
  type Kind,
  type Section,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'

import { endDrag, startDrag, useDropTarget } from './drop-target'
import { FolderMark } from './folder-art'
import { InlineRename } from './inline-rename'
import { KindIcon } from './kind'
import { PinItem, type Pinned, type PinnedTab } from './pinned-tabs'
import { StarGlyph, StarItem } from './star'

export type TreeActions = {
  open: (folder: string | null) => void
  section: (section: Section) => void
  newFolder: (parent: string | null) => void
  rename: (folder: Folder, name: string) => void
  trash: (folder: Folder) => void
  /** Creates a top-level folder by name (the one-click suggestions). */
  create: (name: string) => void
  /** Shows only files of one kind; the same kind again clears it. */
  kind: (kind: Kind) => void
  star: (folder: Folder) => void
}

const SUGGESTED = [translate('contracts'), translate('bankStatements'), translate('tax2026')]
const TYPES: Kind[] = ['pdf', 'image', 'spreadsheet', 'document']

const row =
  'group/row relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg pr-2 text-left text-[14px] text-foreground/75 transition-colors duration-100 outline-none hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 aria-[current=page]:bg-foreground/[0.06] aria-[current=page]:font-medium aria-[current=page]:text-foreground data-current:bg-foreground/[0.06] data-current:font-medium data-current:text-foreground data-drop-over:bg-brand-solid/10 data-drop-over:text-foreground data-drop-over:ring-2 data-drop-over:ring-brand-solid/70'

/** The left column: the workspace's folders as a tree, plus the Trash as a drop target. */
export function FolderTree({
  folders,
  current,
  section,
  trashCount,
  kind,
  pinned,
  actions,
}: {
  folders: Folder[]
  current: string | null
  section: Section
  trashCount: number
  /** The kind filter when exactly one kind is on. */
  kind: Kind | null
  pinned: Pinned
  actions: TreeActions
}) {
  const canWrite = useCan('write:documents')
  const tree = childrenOf(folders)
  // Folders on the way to the open one start expanded; the rest follow the person's clicks.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())
  const onPath = new Set(pathTo(folders, current).map((folder) => folder.id))
  const isOpen = (id: string) => toggled.get(id) ?? onPath.has(id)
  const toggle = (id: string) => setToggled(new Map(toggled).set(id, !isOpen(id)))
  const [renaming, setRenaming] = useState<string | null>(null)
  const root = useDropTarget(null)
  const starred = folders.filter((folder) => folder.starred)
  const trash = useDropTarget('trash')

  const branch = (parent: string, depth: number): ReactNode =>
    (tree.get(parent) ?? []).map((folder, index, siblings) => (
      <TreeNode
        key={folder.id}
        folder={folder}
        depth={depth}
        last={index === siblings.length - 1}
        hasChildren={tree.has(folder.id)}
        expanded={isOpen(folder.id)}
        current={section === 'files' && current === folder.id}
        renaming={renaming === folder.id}
        onToggle={() => toggle(folder.id)}
        onRenameStart={() => setRenaming(folder.id)}
        onRenameDone={(name) => {
          setRenaming(null)
          if (name) actions.rename(folder, name)
        }}
        actions={actions}
      >
        {isOpen(folder.id) && branch(folder.id, depth + 1)}
      </TreeNode>
    ))

  const rootOpen = section === 'files' && current === null && kind === null
  return (
    <div className="flex min-h-full flex-col gap-5 p-3">
      <nav aria-label={translate('folders')} className="grid content-start gap-0.5">
        <button
          type="button"
          aria-current={rootOpen ? 'page' : undefined}
          onClick={() => actions.open(null)}
          className={cn(row, 'h-9 pl-1.5')}
          {...root.props}
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-card text-foreground shadow-elevation-1 ring-1 ring-black/[0.03] dark:ring-foreground/10">
            <HardDrive className="size-3.5 stroke-[1.75]" />
          </span>
          <span className="flex-1 truncate">{translate('allDocuments')}</span>
        </button>
        {starred.length > 0 && (
          <>
            <Label>{translate('starred')}</Label>
            <ul aria-label={translate('starredFolders')} className="grid gap-0.5">
              {starred.map((folder) => (
                <li key={folder.id}>
                  <StarredRow
                    folder={folder}
                    current={section === 'files' && current === folder.id}
                    actions={actions}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <Label
          action={
            canWrite && (
              <button
                type="button"
                aria-label={translate('newFolder')}
                title={translate('newFolder')}
                onClick={() => actions.newFolder(current)}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-70 transition hover:bg-foreground/[0.06] hover:text-foreground hover:opacity-100"
              >
                <Plus className="size-4 stroke-[1.5]" />
              </button>
            )
          }
        >
          {translate('folders')}
        </Label>
        {folders.length > 0 ? (
          <ul aria-label={translate('folderTree')} className="grid">
            {branch('', 0)}
          </ul>
        ) : (
          <div className="grid gap-2 px-2 pt-0.5">
            <div className="grid gap-0.5 text-[12px] leading-4 text-muted-foreground">
              <p>{translate('noFoldersYet')}</p>
              {canWrite && <p>{translate('uploadsAreSortedIntoFoldersAutomatically')}</p>}
            </div>
            {canWrite && (
              <ul aria-label={translate('suggested')} className="flex flex-wrap gap-1.5">
                {SUGGESTED.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      aria-label={translate('createFolderName', { name })}
                      title={translate('createFolderName', { name })}
                      onClick={() => actions.create(name)}
                      className="flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 text-[12px] text-muted-foreground transition-colors outline-none hover:border-foreground/25 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Plus className="size-3 shrink-0 stroke-[1.75]" />
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      <nav aria-label={translate('fileTypes')} className="grid content-start gap-0.5">
        <Label>{translate('types')}</Label>
        {TYPES.map((type) => (
          <Pinnable key={type} pinned={pinned} tab={{ type: 'kind', kind: type }}>
            <button
              type="button"
              aria-current={section === 'files' && kind === type ? 'page' : undefined}
              onClick={() => actions.kind(type)}
              className={cn(row, 'pl-1.5')}
            >
              <KindIcon kind={type} className="size-6 rounded-md" />
              <span className="flex-1 truncate">
                {KIND_LABELS[type]}
                {translate('s')}
              </span>
            </button>
          </Pinnable>
        ))}
      </nav>

      <div className="mt-auto grid gap-0.5">
        <Pinnable pinned={pinned} tab={{ type: 'templates' }}>
          <button
            type="button"
            aria-current={section === 'templates' ? 'page' : undefined}
            onClick={() => actions.section('templates')}
            className={cn(row, 'pl-2.5')}
          >
            <LayoutTemplate className="size-4 shrink-0 stroke-[1.5]" />
            <span className="flex-1 truncate">{translate('templates')}</span>
          </button>
        </Pinnable>
        <Pinnable pinned={pinned} tab={{ type: 'signatures' }}>
          <button
            type="button"
            aria-current={section === 'signatures' ? 'page' : undefined}
            onClick={() => actions.section('signatures')}
            className={cn(row, 'pl-2.5')}
          >
            <FileSignature className="size-4 shrink-0 stroke-[1.5]" />
            <span className="flex-1 truncate">{translate('signatures')}</span>
          </button>
        </Pinnable>
        <Pinnable pinned={pinned} tab={{ type: 'recent' }}>
          <button
            type="button"
            aria-current={section === 'recent' ? 'page' : undefined}
            onClick={() => actions.section('recent')}
            className={cn(row, 'pl-2.5')}
          >
            <Clock className="size-4 shrink-0 stroke-[1.5]" />
            <span className="flex-1 truncate">{translate('recent')}</span>
          </button>
        </Pinnable>
        <Pinnable pinned={pinned} tab={{ type: 'trash' }}>
          <button
            type="button"
            aria-current={section === 'trash' ? 'page' : undefined}
            onClick={() => actions.section('trash')}
            className={cn(row, 'pl-2.5')}
            {...trash.props}
          >
            <Trash2 className="size-4 shrink-0 stroke-[1.5] text-destructive" />
            <span className="min-w-0 truncate">{translate('trash')}</span>
            {trashCount > 0 && <Count>{trashCount}</Count>}
          </button>
        </Pinnable>
      </div>
    </div>
  )
}

/** A sidebar place that can be added as a header tab from its right-click menu. */
function Pinnable({
  pinned,
  tab,
  children,
}: {
  pinned: Pinned
  tab: PinnedTab
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <PinItem pinned={pinned} tab={tab} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** A starred folder: opens it, takes drops, and its star unstars it. */
function StarredRow({
  folder,
  current,
  actions,
}: {
  folder: Folder
  current: boolean
  actions: TreeActions
}) {
  const drop = useDropTarget(folder.id)
  return (
    <div data-current={current || undefined} className={cn(row, 'pl-1.5')} {...drop.props}>
      <button
        type="button"
        aria-current={current ? 'page' : undefined}
        onClick={() => actions.open(folder.id)}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none"
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <FolderMark open={drop.over} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      </button>
      <button
        type="button"
        aria-pressed
        aria-label={translate('unstar2', { name: folder.name })}
        title={translate('unstar')}
        onClick={() => actions.star(folder)}
        className="-mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <StarGlyph className="size-3.5" />
      </button>
    </div>
  )
}

function Label({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="mt-3 flex h-7 items-center justify-between pr-1 pl-2">
      <span className="text-[12px] font-medium text-muted-foreground">{children}</span>
      {action}
    </div>
  )
}

/** A count as a quiet pill right after a name; a bit stronger on the open row so it stays legible. */
function Count({ children }: { children: number }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums group-aria-[current=page]/row:bg-foreground/[0.08] group-data-current/row:bg-foreground/[0.08] dark:bg-foreground/[0.08] dark:group-aria-[current=page]/row:bg-foreground/[0.14] dark:group-data-current/row:bg-foreground/[0.14]">
      {children}
    </span>
  )
}

/**
 * The connector of a tree row (inside a relative <li> of 32px rows): a line down from the parent's
 * icon at `x`, curving into a stub towards this row's icon; the last child's line stops there.
 */
export function TreeGuide({ x, last }: { x: number; last: boolean }) {
  return (
    <>
      {!last && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 bottom-0 w-px bg-border"
          style={{ left: x }}
        />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1 h-5 w-2.5 rounded-bl-[7px] border-b border-l border-border"
        style={{ left: x }}
      />
    </>
  )
}

// Rows indent by one icon column per level; the guide lines hang from the parent's icon centre.
const INDENT = 20
const BASE = 6 // the row's left padding, as "All documents" (pl-1.5)
const ICON_CENTRE = BASE + 12

function TreeNode({
  folder,
  depth,
  last,
  hasChildren,
  expanded,
  current,
  renaming,
  onToggle,
  onRenameStart,
  onRenameDone,
  actions,
  children,
}: {
  folder: Folder
  depth: number
  last: boolean
  hasChildren: boolean
  expanded: boolean
  current: boolean
  renaming: boolean
  onToggle: () => void
  onRenameStart: () => void
  onRenameDone: (name: string | null) => void
  actions: TreeActions
  children: ReactNode
}) {
  const canWrite = useCan('write:documents')
  const drop = useDropTarget(folder.id)
  const guide = ICON_CENTRE + (depth - 1) * INDENT
  return (
    <li className="relative">
      {depth > 0 && <TreeGuide x={guide} last={last} />}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-current={current || undefined}
            className={row}
            style={{ paddingLeft: BASE + depth * INDENT }}
            {...drop.props}
          >
            {hasChildren && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={
                  expanded
                    ? translate('collapse2', { name: folder.name })
                    : translate('expand2', { name: folder.name })
                }
                onClick={onToggle}
                className={cn(
                  // In the panel's padding, left of the row: it takes no width, so icons align at every depth.
                  'absolute top-1/2 -left-3 flex h-4 w-3 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/80 opacity-0 transition-opacity group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground',
                  expanded && 'opacity-100',
                )}
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform duration-150',
                    expanded && 'rotate-90',
                  )}
                />
              </button>
            )}
            {renaming ? (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <FolderMark className="size-4" />
                </span>
                <InlineRename name={folder.name} isFile={false} onDone={onRenameDone} />
              </span>
            ) : (
              <button
                type="button"
                draggable={canWrite}
                aria-current={current ? 'page' : undefined}
                aria-expanded={hasChildren ? expanded : undefined}
                onDragStart={(event) =>
                  startDrag(
                    event,
                    { files: [], folders: [folder.id], from: folder.parent_id },
                    folder.name,
                  )
                }
                onDragEnd={endDrag}
                onClick={() => actions.open(folder.id)}
                onKeyDown={(event) => {
                  if (canWrite && event.key === 'F2') onRenameStart()
                  if (event.key === 'ArrowRight' && hasChildren && !expanded) onToggle()
                  if (event.key === 'ArrowLeft' && expanded) onToggle()
                }}
                className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <FolderMark open={drop.over} className="size-4" />
                </span>
                <span className="min-w-0 truncate">{folder.name}</span>
                {folder.total_files > 0 && <Count>{folder.total_files}</Count>}
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {canWrite && (
            <ContextMenuItem onSelect={() => actions.newFolder(folder.id)}>
              <FolderPlus />
              {translate('newFolderInside')}
            </ContextMenuItem>
          )}
          {canWrite && (
            <ContextMenuItem onSelect={onRenameStart}>
              <Pencil />
              {translate('rename2')}
            </ContextMenuItem>
          )}
          <StarItem folder={folder} onToggle={actions.star} />
          {canWrite && <ContextMenuSeparator />}
          {canWrite && (
            <ContextMenuItem variant="destructive" onSelect={() => actions.trash(folder)}>
              <Trash2 />
              {translate('moveToTrash3')}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {expanded && hasChildren && <ul className="grid">{children}</ul>}
    </li>
  )
}
