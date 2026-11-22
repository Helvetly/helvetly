'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ContextMenu, ContextMenuTrigger } from '@helvetly/ui/components/context-menu'
import { DataTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { Separator } from '@helvetly/ui/components/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@helvetly/ui/components/tooltip'
import { formatDate, formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Link2, Lock, Share2 } from 'lucide-react'
import {
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { UserAvatar } from '@/components/user-avatar'
import {
  docQuery,
  formatSize,
  isRetained,
  KIND_LABELS,
  type DocFile,
  type Folder,
  type SortField,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'
import { usePrefetch } from '@/lib/queries'
import { folderLabel, isSystemFolder } from '@/lib/system-folders'

import { TagChips } from './ai-filing'
import { endDrag, startDrag, useDropTarget } from './drop-target'
import { FolderArt, FolderMark } from './folder-art'
import { InlineRename } from './inline-rename'
import { FileTile, KindIcon } from './kind'
import { MenuButton } from './menu-button'
import { Section, type SectionId } from './section'
import {
  bandRect,
  fileKey,
  folderKey,
  intersects,
  splitKeys,
  type ItemKey,
  type Rect,
} from './selection'
import { ShareDrawer } from './share-drawer'
import { StarGlyph } from './star'
import { FolderName } from './system-mark'
import { Thumbnail } from './thumbnail'

export type ItemsProps = {
  layout: 'grid' | 'list'
  folders: Folder[]
  files: DocFile[]
  selected: ReadonlySet<ItemKey>
  focused: ItemKey | null
  renaming: ItemKey | null
  /** Search results and Recent come from many folders: show where each file is. */
  showLocation: boolean
  /** The folder the files are listed from (for drags): null = top level, '*' = anywhere. */
  from: string | null
  sort: SortField
  desc: boolean
  onSort: (field: SortField, desc: boolean) => void
  onClick: (key: ItemKey, event: MouseEvent) => void
  /** A checkbox adds the item to the selection or takes it out, as ⌘-click does. */
  onToggle: (key: ItemKey) => void
  onToggleAll: (all: boolean) => void
  onOpen: (key: ItemKey) => void
  onRenameDone: (key: ItemKey, name: string | null) => void
  /** Before a context menu opens: make sure the item is part of the selection. */
  onContext: (key: ItemKey) => void
  menu: (key: ItemKey) => ReactNode
  /** The rubber band selected these (added to the selection when ⌘/Shift was held). */
  onBand: (keys: ItemKey[], additive: boolean) => void
  onBackground: () => void
  /** Grid sections folded away, and the Recent strip shown above folders and files. */
  collapsed: ReadonlySet<SectionId>
  onToggleSection: (id: SectionId) => void
  recent?: ReactNode
}

/** Recent, folders, files: a grid of cards or a list with columns; both drag, drop and band-select. */
export function ItemsView(props: ItemsProps) {
  const box = useRef<HTMLDivElement>(null)
  const [band, setBand] = useState<Rect | null>(null)

  // Rubber band: a drag that starts on empty space selects what it crosses.
  const startBand = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (
      event.button !== 0 ||
      !(target instanceof Element) ||
      target.closest('[data-key], button, input, a, [role=menu]')
    )
      return
    const container = box.current
    if (!container) return
    const origin = container.getBoundingClientRect()
    // Kept relative to the container, which scrolls with the page.
    const x0 = event.clientX - origin.left
    const y0 = event.clientY - origin.top
    const additive = event.metaKey || event.ctrlKey || event.shiftKey
    let moved = false
    const move = (next: PointerEvent) => {
      const bounds = container.getBoundingClientRect()
      const rect = bandRect(x0, y0, next.clientX - bounds.left, next.clientY - bounds.top)
      if (!moved && rect.right - rect.left + rect.bottom - rect.top < 6) return
      moved = true
      setBand(rect)
      const hits: ItemKey[] = []
      for (const element of container.querySelectorAll<HTMLElement>('[data-key]')) {
        const r = element.getBoundingClientRect()
        const local = {
          left: r.left - bounds.left,
          top: r.top - bounds.top,
          right: r.right - bounds.left,
          bottom: r.bottom - bounds.top,
        }
        const key = element.dataset.key
        if (
          key &&
          intersects(rect, local) &&
          (key.startsWith('file:') || key.startsWith('folder:'))
        )
          hits.push(key.startsWith('file:') ? fileKey(key.slice(5)) : folderKey(key.slice(7)))
      }
      props.onBand(hits, additive)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setBand(null)
      if (!moved && !additive) props.onBackground()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} onPointerDown={startBand} className="relative min-h-full flex-1 select-none">
      {props.layout === 'grid' ? <Grid {...props} /> : <List {...props} />}
      {band && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 rounded-[3px] border border-primary/50 bg-primary/10"
          style={{
            left: band.left,
            top: band.top,
            width: band.right - band.left,
            height: band.bottom - band.top,
          }}
        />
      )}
    </div>
  )
}

const itemData = (props: ItemsProps, key: ItemKey) => ({
  'data-key': key,
  'data-selected': props.selected.has(key) || undefined,
  'data-focused': props.focused === key || undefined,
})

/** Drag, click, double-click and context-menu wiring shared by every item. */
function useItem(
  props: ItemsProps,
  key: ItemKey,
  name: string,
  folderTarget: string | null,
  system = false,
) {
  const drop = useDropTarget(folderTarget ?? '')
  const isFolder = key.startsWith('folder:')
  const prefetch = usePrefetch(docQuery)
  return {
    over: isFolder && drop.over,
    data: itemData(props, key),
    drop: isFolder ? drop.props : {},
    handlers: {
      draggable: !system,
      onDragStart: (event: DragEvent) => {
        const keys = props.selected.has(key) ? [...props.selected] : [key]
        const split = splitKeys(keys)
        // A system folder never moves, so it stays out of what is dragged.
        const managed = new Set(props.folders.filter(isSystemFolder).map((folder) => folder.id))
        const files = split.files
        const folders = split.folders.filter((id) => !managed.has(id))
        if (files.length + folders.length === 0) return event.preventDefault()
        startDrag(
          event,
          { files, folders, from: props.from },
          files.length + folders.length === 1
            ? name
            : translate('dynamicItems', { length: files.length + folders.length }),
        )
      },
      onDragEnd: endDrag,
      onClick: (event: MouseEvent) => props.onClick(key, event),
      onDoubleClick: () => props.onOpen(key),
      onContextMenu: () => props.onContext(key),
      onPointerEnter: isFolder ? undefined : () => prefetch(key.slice('file:'.length)),
    },
  }
}

type Item = ReturnType<typeof useItem>

/**
 * An item is a button, except while its name is edited: then a plain box, so the field is not
 * inside a button. Extra props come from the context menu trigger.
 */
function Shell({
  item,
  renaming,
  className,
  children,
  ...rest
}: {
  item: Item
  renaming: boolean
  className: string
  children: ReactNode
} & ComponentProps<'button'>) {
  if (renaming)
    return (
      <div {...item.data} {...item.drop} className={className}>
        {children}
      </div>
    )
  return (
    <button
      type="button"
      {...rest}
      {...item.data}
      {...item.handlers}
      {...item.drop}
      onContextMenu={(event) => {
        item.handlers.onContextMenu()
        rest.onContextMenu?.(event)
      }}
      className={cn(className, 'text-left')}
    >
      {children}
    </button>
  )
}

function ItemMenu({
  props,
  item,
  children,
}: {
  props: ItemsProps
  item: ItemKey
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {props.menu(item)}
    </ContextMenu>
  )
}

// ---- grid ----

const card =
  'group/item relative block w-full cursor-pointer rounded-xl bg-card ring-1 ring-border/80 transition-[box-shadow,background-color] duration-150 outline-none hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 data-selected:bg-primary/[0.04] data-selected:ring-2 data-selected:ring-primary/70 data-focused:ring-2 data-focused:ring-ring/50 data-selected:data-focused:ring-primary data-drop-over:bg-primary/[0.06] data-drop-over:ring-2 data-drop-over:ring-primary dark:bg-muted/40'

// A folder has no box: hover is a soft wash, selection and a drop over it a clear ring.
const tile =
  'group/item relative flex w-full cursor-pointer flex-col items-center gap-2.5 rounded-2xl px-2 pt-3 pb-3 outline-none transition-colors duration-150 hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring/50 data-focused:ring-2 data-focused:ring-ring/40 data-selected:bg-primary/[0.07] data-selected:ring-2 data-selected:ring-primary/60 data-selected:data-focused:ring-primary data-drop-over:bg-primary/[0.08] data-drop-over:ring-2 data-drop-over:ring-primary dark:hover:bg-foreground/[0.05] dark:data-selected:bg-primary/[0.14]'

function Grid(props: ItemsProps) {
  const section = (id: SectionId, title: string, children: ReactNode, hint?: string) => (
    <Section
      title={title}
      hint={hint}
      collapsed={props.collapsed.has(id)}
      onToggle={() => props.onToggleSection(id)}
    >
      {children}
    </Section>
  )
  return (
    <div className="@container grid gap-7 p-4 md:p-5">
      {props.recent &&
        section(
          'recent',
          translate('recent'),
          props.recent,
          translate('theLatestUploadsFromEveryFolder'),
        )}
      {props.recent && props.folders.length > 0 && <Separator />}
      {props.folders.length > 0 &&
        section(
          'folders',
          translate('folders'),
          <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-x-2 gap-y-3 @2xl:grid-cols-[repeat(auto-fill,minmax(132px,1fr))]">
            {props.folders.map((folder) => (
              <FolderTile key={folder.id} props={props} folder={folder} />
            ))}
          </div>,
        )}
      {props.files.length > 0 &&
        section(
          'files',
          translate('files'),
          <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-3">
            {props.files.map((file) => (
              <FileCard key={file.id} props={props} file={file} />
            ))}
          </div>,
        )}
    </div>
  )
}

/** The selection checkbox of an item: shown on hover, and on every item once anything is selected. */
function ItemCheck({
  props,
  item,
  name,
  className,
}: {
  props: ItemsProps
  item: ItemKey
  name: string
  className?: string
}) {
  const checked = props.selected.has(item)
  return (
    <Checkbox
      aria-label={translate('select', { name: name })}
      checked={checked}
      onCheckedChange={() => props.onToggle(item)}
      // Not the card's click (which replaces the selection), and never the start of a drag.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'size-5 cursor-pointer rounded-[5px] bg-card dark:bg-card [&_svg]:size-3.5',
        !checked &&
          props.selected.size === 0 &&
          'opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 focus-visible:opacity-100',
        className,
      )}
    />
  )
}

const filesAndSize = (count: number, size: number) =>
  count === 0
    ? translate('empty')
    : `${count} ${count === 1 ? 'file' : 'files'} · ${formatSize(size)}`

/** A folder as a big glossy illustration, its name and what is inside. */
function FolderTile({ props, folder }: { props: ItemsProps; folder: Folder }) {
  const key = folderKey(folder.id)
  const item = useItem(props, key, folderLabel(folder), folder.id, isSystemFolder(folder))
  const renaming = props.renaming === key
  return (
    <div className="group/card relative">
      <ItemMenu props={props} item={key}>
        <Shell
          item={item}
          renaming={renaming}
          title={filesAndSize(folder.total_files, folder.total_size)}
          className={tile}
        >
          {folder.starred && (
            <span className="absolute top-3 right-3" title={translate('starred')}>
              <StarGlyph className="size-4" />
            </span>
          )}
          {/* The art sits a little smaller inside the box it used to fill, so the tile keeps its size. */}
          <span className="flex aspect-[5/4] w-16 items-center justify-center @2xl:w-[90px]">
            <FolderArt full={folder.total_files > 0} className="w-14 @2xl:w-[78px]" />
          </span>
          <span className="block w-full min-w-0 text-center">
            {renaming ? (
              <InlineRename
                name={folder.name}
                isFile={false}
                onDone={(name) => props.onRenameDone(key, name)}
              />
            ) : (
              <span
                className="flex justify-center text-[13.5px] leading-5 font-medium"
                title={folderLabel(folder)}
              >
                <FolderName folder={folder} />
              </span>
            )}
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {translate('updated2')}
              {formatRelative(folder.updated_at)}
            </span>
          </span>
        </Shell>
      </ItemMenu>
      <ItemCheck
        props={props}
        item={key}
        name={folderLabel(folder)}
        className="absolute top-2.5 left-2.5 z-[2]"
      />
    </div>
  )
}

function FileCard({ props, file }: { props: ItemsProps; file: DocFile }) {
  const key = fileKey(file.id)
  const item = useItem(props, key, file.name, null)
  const renaming = props.renaming === key
  const [sharing, setSharing] = useState(false)
  return (
    <div className="group/card relative">
      <ItemMenu props={props} item={key}>
        <Shell
          item={item}
          renaming={renaming}
          className={cn(card, 'flex flex-col overflow-hidden')}
        >
          <FileBadges file={file} className="absolute top-2 right-2 z-[1]" />
          <Thumbnail
            file={file}
            className="aspect-[4/3] w-full border-b border-border/60 bg-muted/60 dark:bg-background/40"
          />
          <span className="flex w-full items-start gap-2 px-3 pt-2.5 pb-3">
            <KindIcon kind={file.kind} className="mt-0.5 size-5 rounded-[5px] [&_svg]:size-3" />
            <span className="block min-w-0 flex-1">
              {renaming ? (
                <InlineRename
                  name={file.name}
                  isFile
                  onDone={(name) => props.onRenameDone(key, name)}
                />
              ) : (
                <span
                  className="block truncate text-[13.5px] leading-5 font-medium"
                  title={file.name}
                >
                  {file.name}
                </span>
              )}
              <span className="block truncate text-[12px] text-muted-foreground">
                {props.showLocation
                  ? file.folder
                    ? folderLabel(file.folder)
                    : translate('allDocuments')
                  : `${formatSize(file.size)} · ${formatDate(file.created_at)}`}
              </span>
            </span>
          </span>
        </Shell>
      </ItemMenu>
      <ItemCheck
        props={props}
        item={key}
        name={file.name}
        className="absolute top-2 left-2 z-[2]"
      />
      <span
        className={cn(
          'absolute right-2 bottom-2 z-[2] rounded-md bg-card/90 opacity-0 transition-opacity group-hover/card:opacity-100 has-focus-visible:opacity-100',
        )}
      >
        <ShareButton file={file} onOpen={() => setSharing(true)} />
      </span>
      {sharing && <ShareDrawer file={file} onClose={() => setSharing(false)} />}
    </div>
  )
}

/** The one "Share with client" icon button (list row and grid card), labelled by a tooltip. */
function ShareButton({ file, onOpen }: { file: DocFile; onOpen: () => void }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={translate('shareWithAClient', { name: file.name })}
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="relative z-[1] text-muted-foreground"
          >
            <Share2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{translate('shareWithClient2')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Small marks for links and business records. */
function FileBadges({ file, className }: { file: DocFile; className?: string }) {
  const retained = isRetained(file.retained_until)
  if (!retained && file.links.length === 0) return null
  return (
    <span className={cn('flex gap-1', className)}>
      {file.links.length > 0 && (
        <span
          title={file.links.map((link) => link.label).join(', ')}
          className="flex h-5 items-center gap-0.5 rounded-full bg-card/95 px-1.5 text-[11px] text-muted-foreground shadow-elevation-1"
        >
          <Link2 className="size-3" />
          {file.links.length}
        </span>
      )}
      {retained && (
        <span
          title={translate('businessRecordKeptUntil', { retained_until: file.retained_until })}
          className="flex size-5 items-center justify-center rounded-full bg-[#ece9d5] text-[#827851] shadow-elevation-1 dark:bg-amber-500/20 dark:text-amber-300"
        >
          <Lock className="size-3" />
        </span>
      )}
    </span>
  )
}

// ---- list ----

/** A folder or a file: the list shows folders first, in one table. */
type Row = { key: ItemKey } & ({ folder: Folder } | { file: DocFile })

/** Which list sort each sortable column asks for. */
const SORTS: Partial<Record<string, SortField>> = {
  name: 'name',
  created: 'created_at',
  modified: 'updated_at',
}

function List(props: ItemsProps) {
  const rows: Row[] = [
    ...props.folders.map((folder) => ({ key: folderKey(folder.id), folder })),
    ...props.files.map((file) => ({ key: fileKey(file.id), file })),
  ]
  const picked = rows.filter((row) => props.selected.has(row.key)).length
  return (
    <DataTable
      id="documents"
      label={translate('files')}
      columns={listColumns(props, picked, rows.length)}
      data={rows}
      getRowId={(row) => row.key}
      sorting={{
        column: Object.keys(SORTS).find((column) => SORTS[column] === props.sort),
        desc: props.desc,
        onSort: (column, desc) => {
          const field = SORTS[column]
          if (field) props.onSort(field, desc)
        },
      }}
      rowProps={(row) => ({
        ...itemData(props, row.key),
        className:
          'group/row cursor-pointer outline-none data-drop-over:bg-primary/10 data-focused:shadow-[inset_2px_0_0_var(--ring)]',
      })}
      renderRow={(row, tr) => (
        <ListRow props={props} row={row}>
          {tr}
        </ListRow>
      )}
    />
  )
}

/** A row's drag, drop, click and context menu: merged onto the table's `<tr>` by the trigger. */
function ListRow({ props, row, children }: { props: ItemsProps; row: Row; children: ReactNode }) {
  const system = 'folder' in row && isSystemFolder(row.folder)
  const item = useItem(props, row.key, rowName(row), 'folder' in row ? row.folder.id : null, system)
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        {...item.handlers}
        {...item.drop}
        draggable={props.renaming !== row.key && !system}
      >
        {children}
      </ContextMenuTrigger>
      {props.menu(row.key)}
    </ContextMenu>
  )
}

const rowName = (row: Row) => ('folder' in row ? folderLabel(row.folder) : row.file.name)

function listColumns(props: ItemsProps, picked: number, total: number): DataColumn<Row>[] {
  return [
    {
      id: 'select',
      header: translate('selectAll3'),
      headerContent: (
        <Checkbox
          aria-label={translate('selectAll3')}
          className="bg-card"
          checked={picked === 0 ? false : picked === total ? true : 'indeterminate'}
          onCheckedChange={() => props.onToggleAll(picked < total)}
        />
      ),
      cell: (row) => (
        <ItemCheck
          props={props}
          item={row.key}
          name={rowName(row)}
          className="size-4 rounded-[4px] opacity-100"
        />
      ),
    },
    {
      id: 'name',
      header: translate('name'),
      flex: true,
      sortable: true,
      cell: (row) =>
        'folder' in row ? (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-8 shrink-0 items-center justify-center">
              <FolderMark className="size-6" />
            </span>
            <NameCell
              props={props}
              item={row.key}
              name={folderLabel(row.folder)}
              label={<FolderName folder={row.folder} />}
              isFile={false}
              detail={filesAndSize(row.folder.total_files, row.folder.total_size)}
            />
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-3">
            <FileTile file={row.file} />
            <NameCell
              props={props}
              item={row.key}
              name={row.file.name}
              isFile
              detail={`${formatSize(row.file.size)} · ${KIND_LABELS[row.file.kind]}`}
              aside={<TagChips tags={row.file.tags} />}
            />
          </span>
        ),
    },
    ...(props.showLocation
      ? [
          {
            id: 'location',
            header: translate('location'),
            size: 160,
            minSize: 100,
            className: 'text-muted-foreground',
            cell: (row: Row) =>
              'folder' in row ? (
                '—'
              ) : (
                <span className="flex min-w-0 items-center gap-1.5">
                  <FolderMark className="size-4" />
                  <span className="truncate">
                    {row.file.folder ? folderLabel(row.file.folder) : translate('allDocuments')}
                  </span>
                </span>
              ),
          },
        ]
      : []),
    {
      id: 'uploaded',
      header: translate('uploadedBy'),
      size: 180,
      minSize: 120,
      showFrom: 850,
      className: 'text-muted-foreground',
      cell: (row) => (
        <Person person={'folder' in row ? row.folder.created_by : row.file.uploaded_by} />
      ),
    },
    {
      id: 'created',
      header: translate('created3'),
      size: 120,
      minSize: 96,
      sortable: true,
      sortDescFirst: true,
      showFrom: 970,
      className: 'text-muted-foreground',
      cell: (row) => formatDate('folder' in row ? row.folder.created_at : row.file.created_at),
    },
    {
      id: 'modified',
      header: translate('modified'),
      size: 120,
      minSize: 96,
      sortable: true,
      sortDescFirst: true,
      className: 'text-muted-foreground',
      cell: (row) => formatDate('folder' in row ? row.folder.updated_at : row.file.updated_at),
    },
    {
      id: 'status',
      header: translate('status'),
      size: 150,
      showFrom: 720,
      cell: (row) =>
        'folder' in row ? (
          row.folder.starred && <StarGlyph className="size-3.5" />
        ) : (
          <StatusPill file={row.file} />
        ),
    },
    {
      id: 'actions',
      header: translate('actions'),
      headerContent: <span className="sr-only">{translate('actions')}</span>,
      // The share button and the menu.
      size: 80,
      className:
        'pl-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-data-selected/row:opacity-100 has-focus-visible:opacity-100',
      cell: (row) =>
        'folder' in row ? (
          <MenuButton label={translate('actionsFor', { name: folderLabel(row.folder) })} />
        ) : (
          <FileActions file={row.file} />
        ),
    },
  ]
}

/** Name over a muted second line, as every list row shows it. */
function NameCell({
  props,
  item,
  name,
  label,
  isFile,
  detail,
  aside,
}: {
  props: ItemsProps
  item: ItemKey
  name: string
  /** What shows instead of the name while it is not edited (a system folder's translated name and lock). */
  label?: ReactNode
  isFile: boolean
  detail: string
  /** After the detail line's text: a file's tags. */
  aside?: ReactNode
}) {
  return (
    <span className="block min-w-0 flex-1">
      {props.renaming === item ? (
        <InlineRename
          name={name}
          isFile={isFile}
          onDone={(next) => props.onRenameDone(item, next)}
        />
      ) : (
        <span className={cn('block leading-5 font-medium', !label && 'truncate')} title={name}>
          {label ?? name}
        </span>
      )}
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="shrink-0 truncate">{detail}</span>
        {aside}
      </span>
    </span>
  )
}

function Person({ person }: { person: { name: string; avatar_url?: string | null } | null }) {
  if (!person?.name) return <span>—</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar name={person.name} url={person.avatar_url} className="size-6" />
      <span className="truncate text-foreground/85">{person.name}</span>
    </span>
  )
}

/** "Business record" or "Linked", as a quiet pill. */
function StatusPill({ file }: { file: DocFile }) {
  const retained = isRetained(file.retained_until)
  if (!retained && file.links.length === 0) return null
  return (
    <span
      title={
        retained
          ? translate('keptUntil', { retained_until: file.retained_until })
          : file.links.map((link) => link.label).join(', ')
      }
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border/80 px-2 text-[12px] text-foreground/80"
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          retained ? 'bg-[#4a9a6a] dark:bg-[#6fcf97]' : 'bg-[#4e9ad0] dark:bg-[#62acdf]',
        )}
      />
      <span className="truncate">
        {retained
          ? translate('businessRecord')
          : translate('linked', { value1: file.links.length > 1 ? ` · ${file.links.length}` : '' })}
      </span>
    </span>
  )
}

function FileActions({ file }: { file: DocFile }) {
  const [sharing, setSharing] = useState(false)
  return (
    <>
      <span className="flex items-center justify-end">
        <ShareButton file={file} onOpen={() => setSharing(true)} />
        <MenuButton label={translate('actionsFor', { name: file.name })} />
      </span>
      {sharing && <ShareDrawer file={file} onClose={() => setSharing(false)} />}
    </>
  )
}
