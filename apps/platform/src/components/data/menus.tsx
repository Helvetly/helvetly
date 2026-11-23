'use client'
import {
  ActionMenuBody,
  ActionMenuContent,
  actionMenuHeaderClass,
  type ActionMenuSpec,
} from '@helvetly/ui/components/action-menu'
import { Button } from '@helvetly/ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@helvetly/ui/components/context-menu'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { CheckCheck, Ellipsis, Plus, RefreshCw, Rows3 } from 'lucide-react'
import type { MouseEvent, ReactElement } from 'react'

import { translate } from '@/lib/i18n'
import { useCanWriteHere } from '@/lib/permissions'

import type { BulkAction } from './table-page'

/** An item's menu: its header line ("#12 · Muster AG") and its actions, written once. */
export type RowMenuSpec = ActionMenuSpec

/** The header line of an item's menu, e.g. "#12 · Muster AG". */
export const titleClass = actionMenuHeaderClass

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

/** The "…" button at the end of a row. */
export function RowMenuButton({ label, menu }: { label: string; menu: RowMenuSpec }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <ActionMenuContent kind="dropdown" menu={menu} />
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
      {many ? (
        <BulkMenu count={many.count} actions={many.actions} />
      ) : (
        <ActionMenuContent kind="context" menu={menu} />
      )}
    </ContextMenu>
  )
}

/** The selection's actions; a member without write sees only those that change nothing. */
function BulkMenu({ count, actions }: { count: number; actions: BulkAction[] }) {
  const writable = useCanWriteHere()
  return (
    <ActionMenuContent
      kind="context"
      menu={{
        header: translate('dynamicSelected', { count }),
        actions: actions
          .filter((action) => writable || !action.write)
          .map((action) => ({
            id: action.label,
            group: action.destructive ? 'danger' : 'edit',
            label: action.label,
            icon: action.icon,
            onSelect: action.onClick,
            disabledReason: action.disabled,
          })),
      }}
    />
  )
}

/**
 * Right-click on a page's content outside any item: the page's own actions (the primary button
 * and the header's "…" items), selecting, switching view and refreshing. Items have their own menu.
 */
export function PageContextMenu({
  title,
  primary,
  actions,
  views,
  selectAll,
  onRefresh,
  disabled,
  children,
}: {
  title: string
  /** The header's solid button, e.g. "New client". */
  primary?: { label: string; onSelect: () => void }
  /** More page actions, the same list that fills the header's "…" menu. */
  actions?: ActionMenuSpec['actions']
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
        <ActionMenuBody
          kind="context"
          menu={{
            header: title,
            actions: [
              primary &&
                writable && {
                  id: 'new',
                  group: 'create',
                  label: primary.label,
                  icon: <Plus />,
                  onSelect: primary.onSelect,
                },
              ...(actions ?? []),
            ],
          }}
        />
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
