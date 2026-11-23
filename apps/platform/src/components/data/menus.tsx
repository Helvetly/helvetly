'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@helvetly/ui/components/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { CheckCheck, Ellipsis, Plus, RefreshCw, Rows3 } from 'lucide-react'
import type { ComponentType, MouseEvent, ReactElement, ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { useCanWriteHere } from '@/lib/permissions'

import type { BulkAction } from './table-page'

type ItemProps = {
  onSelect?: (event: Event) => void
  variant?: 'default' | 'destructive'
  disabled?: boolean
  asChild?: boolean
  className?: string
  children: ReactNode
}

/** The parts a menu is built from: one list of actions renders as a "…" menu and a right-click menu. */
export type MenuKit = {
  Item: ComponentType<ItemProps>
  Separator: ComponentType
  /** Only for a key that really does it, e.g. ⌘V. */
  Shortcut: ComponentType<{ children: ReactNode }>
}

export const dropdownKit: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
}
export const contextKit: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
}

/** A row's actions: the header line ("#12 · Muster AG") and the items, written once. */
export type RowMenuSpec = { title: string; items: (kit: MenuKit) => ReactNode }

/** The header line of an item's menu, e.g. "#12 · Muster AG". */
export const titleClass = 'truncate text-xs font-normal text-muted-foreground'

/**
 * Text fields keep the browser's own menu (spelling, paste), and so do portalled menus and
 * dialogs that React bubbles up here: stopped in the capture phase, Radix never sees the event.
 */
function keepNativeMenu(event: MouseEvent<Element>) {
  const target = event.target
  if (
    !(target instanceof Element) ||
    !event.currentTarget.contains(target) ||
    target.closest('input, textarea, select, [contenteditable=true]')
  )
    event.stopPropagation()
}

/**
 * A menu item's label, with why it is unavailable on a line under it: a disabled item takes no pointer, so it
 * could show no tooltip.
 */
export function MenuText({ label, why }: { label: string; why?: string }) {
  return why ? (
    <span className="grid">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{why}</span>
    </span>
  ) : (
    label
  )
}

/** The "…" button at the end of a row. */
export function RowMenuButton({ label, menu }: { label: string; menu: RowMenuSpec }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className={titleClass}>{menu.title}</DropdownMenuLabel>
        {menu.items(dropdownKit)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Right-click, the context-menu key or a long press on a row: the row's own actions, or the bulk
 * actions when the row is part of a larger selection. It never changes the selection.
 */
export function RowContextMenu({
  menu,
  bulk,
  children,
}: {
  menu: RowMenuSpec
  /** The selection, passed only when this row is in it. */
  bulk?: { count: number; actions: BulkAction[] }
  children: ReactElement
}) {
  const many = bulk && bulk.count > 1 ? bulk : null
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        className="data-[state=open]:bg-muted/60"
        onContextMenuCapture={keepNativeMenu}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuLabel className={titleClass}>
          {many ? translate('dynamicSelected', { count: many.count }) : menu.title}
        </ContextMenuLabel>
        {many ? <BulkItems actions={many.actions} /> : menu.items(contextKit)}
      </ContextMenuContent>
    </ContextMenu>
  )
}

const bulkItem = ({ label, icon, onClick, destructive }: BulkAction) => (
  <ContextMenuItem key={label} variant={destructive ? 'destructive' : 'default'} onSelect={onClick}>
    {icon} {label}
  </ContextMenuItem>
)

function BulkItems({ actions }: { actions: BulkAction[] }) {
  const writable = useCanWriteHere()
  const allowed = actions.filter((action) => writable || !action.write)
  const safe = allowed.filter((action) => !action.destructive)
  const destructive = allowed.filter((action) => action.destructive)
  return (
    <>
      {safe.map(bulkItem)}
      {safe.length > 0 && destructive.length > 0 && <ContextMenuSeparator />}
      {destructive.map(bulkItem)}
    </>
  )
}

/**
 * Right-click on a page's content outside any item: the page's own actions (the primary button
 * and the header's "…" items), selecting, switching view and refreshing. Items have their own menu.
 */
export function PageContextMenu({
  title,
  primary,
  items,
  views,
  selectAll,
  onRefresh,
  disabled,
  children,
}: {
  title: string
  /** The header's solid button, e.g. "New client". */
  primary?: { label: string; onSelect: () => void }
  /** More page actions, the same function that fills the header's "…" menu. */
  items?: (kit: MenuKit) => ReactNode
  views?: { tabs: string[]; active: number; onSelect: (index: number) => void }
  /** Passed only while there is something left to select; `keys` when a shortcut does it too. */
  selectAll?: { onSelect: () => void; keys?: string }
  onRefresh: () => void
  disabled?: boolean
  children: ReactElement
}) {
  const writable = useCanWriteHere()
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled} onContextMenuCapture={keepNativeMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ContextMenuLabel className={titleClass}>{title}</ContextMenuLabel>
        {primary && writable && (
          <ContextMenuItem onSelect={primary.onSelect}>
            <Plus /> {primary.label}
          </ContextMenuItem>
        )}
        {items?.(contextKit)}
        <ContextMenuSeparator />
        {selectAll && (
          <ContextMenuItem onSelect={selectAll.onSelect}>
            <CheckCheck />
            {translate('selectAll')}
            {selectAll.keys && <ContextMenuShortcut>{selectAll.keys}</ContextMenuShortcut>}
          </ContextMenuItem>
        )}
        {views && views.tabs.length > 1 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Rows3 />
              {translate('view')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={String(views.active)}
                onValueChange={(index) => views.onSelect(Number(index))}
              >
                {views.tabs.map((tab, index) => (
                  <ContextMenuRadioItem key={tab} value={String(index)}>
                    {tab}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuItem onSelect={onRefresh}>
          <RefreshCw />
          {translate('refresh')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
