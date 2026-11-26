'use client'
import { ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { Button } from '@helvetly/ui/components/button'
import { ContextMenu, ContextMenuTrigger } from '@helvetly/ui/components/context-menu'
import { CountBadge } from '@helvetly/ui/components/count-badge'
import { TruncatedText } from '@helvetly/ui/components/truncated-text'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Check,
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
import { folderLabel, isSystemFolder, withoutEmptySystem } from '@/lib/system-folders'

import { endDrag, startDrag, useDropTarget } from './drop-target'
import { FolderMark } from './folder-art'
import { InlineRename } from './inline-rename'
import { KindIcon } from './kind'
import { pinAction, type Pinned, type PinnedTab } from './pinned-tabs'
import { StarGlyph, starAction } from './star'
import { FolderName } from './system-mark'

export type TreeActions = {
  open: (folder: string | null) => void
  section: (section: Section) => void
  newFolder: (parent: string | null) => void
  rename: (folder: Folder, name: string) => void
  trash: (folder: Folder) => void
  /** Creates a top-level folder by name (the one-click suggestions). */
  create: (name: string) => void
  /** Shows only files of these kinds (any of them); none shows every kind. */
  kinds: (kinds: Kind[]) => void
  star: (folder: Folder) => void
}

const SUGGESTED = [translate('contracts'), translate('bankStatements'), translate('tax2026')]
const TYPES: Kind[] = ['pdf', 'image', 'spreadsheet', 'document']

const row =
  'group/row relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg pr-2.5 text-left text-[14px] text-foreground/75 transition-colors duration-100 outline-none hover:bg-foreground/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 has-[:focus-visible:not(input)]:ring-2 has-[:focus-visible:not(input)]:ring-ring/50 aria-[current=page]:bg-foreground/[0.06] aria-[current=page]:font-medium aria-[current=page]:text-foreground data-current:bg-foreground/[0.06] data-current:font-medium data-current:text-foreground data-drop-over:bg-brand-solid/10 data-drop-over:text-foreground data-drop-over:ring-2 data-drop-over:ring-brand-solid/70'

/** The left column: the workspace's folders as a tree, plus the Trash as a drop target. */
export function FolderTree({
  folders,
  current,
  section,
  trashCount,
  kinds,
  pinned,
  actions,
}: {
  folders: Folder[]
  current: string | null
  section: Section
  trashCount: number
  /** The kind filter: the types toggled on (the Filters popover's Kind and its chip). */
  kinds: readonly Kind[]
  pinned: Pinned
  actions: TreeActions
}) {
  const canWrite = useCan('write:documents')
  const onPath = new Set(pathTo(folders, current).map((folder) => folder.id))
  const tree = childrenOf(withoutEmptySystem(folders, onPath))
  // Folders on the way to the open one start expanded; the rest follow the person's clicks.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map())
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

  const rootOpen = section === 'files' && current === null && kinds.length === 0
  const picked = section === 'files' ? kinds : []
  return (
    <div className="flex min-h-full flex-col gap-5 p-3">
      <nav aria-label={translate('folders')} className="grid grid-cols-1 content-start gap-0.5">
        <button
          type="button"
          aria-current={rootOpen ? 'page' : undefined}
          onClick={() => actions.open(null)}
          className={cn(row, 'pl-2.5')}
          {...root.props}
        >
          <HardDrive className="size-4 shrink-0 stroke-[1.5]" />
          <TruncatedText className="flex-1">{translate('allDocuments')}</TruncatedText>
        </button>
        <Pinnable pinned={pinned} tab={{ type: 'recent' }}>
          <button
            type="button"
            aria-current={section === 'recent' ? 'page' : undefined}
            onClick={() => actions.section('recent')}
            className={cn(row, 'pl-2.5')}
          >
            <Clock className="size-4 shrink-0 stroke-[1.5]" />
            <TruncatedText className="flex-1">{translate('recent')}</TruncatedText>
          </button>
        </Pinnable>
        <Pinnable pinned={pinned} tab={{ type: 'templates' }}>
          <button
            type="button"
            aria-current={section === 'templates' ? 'page' : undefined}
            onClick={() => actions.section('templates')}
            className={cn(row, 'pl-2.5')}
          >
            <LayoutTemplate className="size-4 shrink-0 stroke-[1.5]" />
            <TruncatedText className="flex-1">{translate('templates')}</TruncatedText>
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
            <TruncatedText className="flex-1">{translate('signatures')}</TruncatedText>
          </button>
        </Pinnable>
        {starred.length > 0 && (
          <>
            <Label>{translate('starred')}</Label>
            <ul aria-label={translate('starredFolders')} className="grid grid-cols-1 gap-0.5">
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
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('newFolder')}
                title={translate('newFolder')}
                onClick={() => actions.newFolder(current)}
                className="text-muted-foreground"
              >
                <Plus className="size-4 stroke-[1.5]" />
              </Button>
            )
          }
        >
          {translate('folders')}
        </Label>
        {folders.length > 0 ? (
          <ul aria-label={translate('folderTree')} className="grid grid-cols-1">
            {branch('', 0)}
          </ul>
        ) : (
          // A hint, not a warning: the info tint, like the other first-run notes.
          <div className="mx-1 grid gap-2 rounded-lg bg-info-surface p-2.5 ring-1 ring-info/20 ring-inset">
            <div className="grid gap-0.5 text-[12px] leading-4 text-muted-foreground">
              <p className="font-medium text-foreground">{translate('noFoldersYet')}</p>
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
                      className="flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 text-[12px] text-muted-foreground transition-colors outline-none hover:border-foreground/25 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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

      <nav aria-label={translate('fileTypes')} className="grid grid-cols-1 content-start gap-0.5">
        <Label
          action={
            picked.length > 0 && (
              <button
                type="button"
                onClick={() => actions.kinds([])}
                className="cursor-pointer rounded-sm text-caption text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {translate('clear')}
              </button>
            )
          }
        >
          {translate('types')}
        </Label>
        {TYPES.map((type) => {
          const on = picked.includes(type)
          return (
            <Pinnable key={type} pinned={pinned} tab={{ type: 'kind', kind: type }}>
              {/* A toggle: several types combine (any of them), the same state as the Kind filter. */}
              <button
                type="button"
                aria-pressed={on}
                data-current={on || undefined}
                onClick={() =>
                  actions.kinds(on ? picked.filter((kind) => kind !== type) : [...picked, type])
                }
                className={cn(row, 'pl-1.5')}
              >
                <KindIcon kind={type} className="size-6 rounded-md" />
                <TruncatedText className="flex-1">{`${KIND_LABELS[type]}${translate('s')}`}</TruncatedText>
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-foreground/20 opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
                  )}
                >
                  {on && <Check className="size-3 stroke-[2.5]" />}
                </span>
              </button>
            </Pinnable>
          )
        })}
      </nav>

      <div className="mt-auto grid gap-0.5">
        <Pinnable pinned={pinned} tab={{ type: 'trash' }}>
          <button
            type="button"
            aria-current={section === 'trash' ? 'page' : undefined}
            onClick={() => actions.section('trash')}
            className={cn(row, 'pl-2.5')}
            {...trash.props}
          >
            <Trash2 className="size-4 shrink-0 stroke-[1.5] text-destructive" />
            <TruncatedText>{translate('trash')}</TruncatedText>
            {trashCount > 0 && <CountBadge>{trashCount}</CountBadge>}
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
      <ActionMenuContent
        kind="context"
        className="min-w-48"
        menu={{ actions: [pinAction(pinned, tab)] }}
      />
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
        <span className="min-w-0 flex-1">
          <FolderName folder={folder} />
        </span>
      </button>
      <button
        type="button"
        aria-pressed
        aria-label={translate('unstar2', { name: folderLabel(folder) })}
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
    <div className="mt-3 flex h-7 items-center justify-between px-2.5">
      <span className="text-[12px] font-medium text-muted-foreground">{children}</span>
      {action}
    </div>
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
const BASE = 6 // the row's left padding; with the 24px icon box, icons centre where "Recent"'s does
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
  const system = isSystemFolder(folder)
  const toggleLabel = expanded
    ? translate('collapse2', { name: folderLabel(folder) })
    : translate('expand2', { name: folderLabel(folder) })
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
            {renaming ? (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <FolderMark className="size-4" />
                </span>
                <InlineRename name={folder.name} isFile={false} onDone={onRenameDone} />
              </span>
            ) : (
              <>
                {hasChildren && (
                  // The folder's own icon is its disclosure: open while expanded, closed while not.
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    onClick={onToggle}
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-foreground/[0.06]"
                  >
                    <FolderMark open={expanded || drop.over} className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  draggable={canWrite && !system}
                  aria-current={current ? 'page' : undefined}
                  onDragStart={(event) =>
                    startDrag(
                      event,
                      { files: [], folders: [folder.id], from: folder.parent_id },
                      folderLabel(folder),
                    )
                  }
                  onDragEnd={endDrag}
                  onClick={() => actions.open(folder.id)}
                  onKeyDown={(event) => {
                    if (canWrite && !system && event.key === 'F2') onRenameStart()
                    // Handled arrows stay in the tree; the page would otherwise move the grid's selection too.
                    if (event.key === 'ArrowRight' && hasChildren && !expanded) {
                      event.preventDefault()
                      onToggle()
                    }
                    if (event.key === 'ArrowLeft' && expanded) {
                      event.preventDefault()
                      onToggle()
                    }
                  }}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none"
                >
                  {!hasChildren && (
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      <FolderMark open={drop.over} className="size-4" />
                    </span>
                  )}
                  <FolderName folder={folder} />
                  {folder.total_files > 0 && <CountBadge>{folder.total_files}</CountBadge>}
                </button>
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ActionMenuContent
          kind="context"
          menu={{
            header: folderLabel(folder),
            actions: [
              starAction(folder, actions.star),
              canWrite &&
                !system && {
                  id: 'rename',
                  group: 'edit',
                  icon: <Pencil />,
                  label: translate('rename2'),
                  onSelect: onRenameStart,
                },
              canWrite && {
                id: 'new-folder',
                group: 'create',
                icon: <FolderPlus />,
                label: translate('newFolderInside'),
                onSelect: () => actions.newFolder(folder.id),
              },
              canWrite &&
                !system && {
                  id: 'trash',
                  group: 'danger',
                  icon: <Trash2 />,
                  label: translate('moveToTrash3'),
                  onSelect: () => actions.trash(folder),
                },
            ],
          }}
        />
      </ContextMenu>
      {expanded && hasChildren && <ul className="grid grid-cols-1">{children}</ul>}
    </li>
  )
}
