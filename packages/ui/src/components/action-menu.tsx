'use client'

import { cn } from 'cn'
import { Fragment, useState, type ReactNode } from 'react'

import {
  ContextMenuCheckboxItem,
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
} from './context-menu'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

/**
 * Every action menu (a "…" button, a right-click menu, a drawer's "…") is one list of actions in
 * the same fixed groups, separated, in this order:
 * 1. view: Open details, Preview, Download PDF, Export
 * 2. send: Send, Send again, Remind, Copy link
 * 3. status: Issue, Accept, Mark paid (success tone); Decline, Void, Cancel (destructive tone)
 * 4. edit: Edit, Revise, Rename, Move, Duplicate
 * 5. create: Create invoice, Create contract with AI (ai tone), Create engagement
 * 6. danger: Delete, Archive (destructive tone), always alone and last
 * Callers say which group an action is in; the order is the component's, never theirs.
 */
export const ACTION_GROUPS = ['view', 'send', 'status', 'edit', 'create', 'danger'] as const
export type ActionGroup = (typeof ACTION_GROUPS)[number]

export type ActionTone = 'default' | 'success' | 'destructive' | 'ai'

export type Action = {
  /** Unique within the menu: the React key, and `data-action` for tests. */
  id: string
  group: ActionGroup
  label: ReactNode
  /** Every action has one: a lucide icon element, or Heidi's sparkle for AI. */
  icon: ReactNode
  /** Default: destructive in the danger group, neutral elsewhere. */
  tone?: ActionTone
  onSelect?: () => void
  /** A link instead of a handler, e.g. a PDF to download. */
  href?: string
  download?: boolean
  disabled?: boolean
  /** Why it is disabled, shown as its tooltip; the item stays hoverable and focusable for it. */
  disabledReason?: string
  /** Only for a key that really does it, e.g. ⌘V. */
  shortcut?: string
  /** Beside the label, e.g. the plan tag of a locked feature. */
  extra?: ReactNode
  /** A setting switched on and off from the menu: shown with a check mark; `onSelect` toggles it. */
  checked?: boolean
  /**
   * Choices of one action (e-invoice formats), opened beside it; their groups are ignored. When every
   * choice says whether it is `checked`, they are one pick (radio items).
   */
  submenu?: Action[]
}

/** An item's menu: the muted header line ("#12 · Muster AG") and its actions; falsy ones are left out. */
export type ActionMenuSpec = {
  header?: ReactNode
  actions: (Action | false | null | undefined)[]
}

export type ActionMenuKind = 'dropdown' | 'context'

/** The muted header line of an item's menu. */
export const actionMenuHeaderClass = 'truncate text-xs font-normal text-muted-foreground'

/**
 * Toned items keep their colour at rest, on hover and on keyboard focus: a soft tint of the tone
 * behind text and icon in the tone (≥ 4.5:1 in both themes). Destructive comes from the item's
 * own `destructive` variant.
 */
const toneClass = cn(
  'data-[tone=success]:text-success data-[tone=success]:focus:bg-success/10 data-[tone=success]:focus:text-success dark:data-[tone=success]:focus:bg-success/15',
  'data-[tone=ai]:text-brand data-[tone=ai]:focus:bg-brand/10 data-[tone=ai]:focus:text-brand dark:data-[tone=ai]:focus:bg-brand/15',
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
)

const parts = {
  dropdown: {
    Item: DropdownMenuItem,
    CheckboxItem: DropdownMenuCheckboxItem,
    RadioGroup: DropdownMenuRadioGroup,
    RadioItem: DropdownMenuRadioItem,
    Label: DropdownMenuLabel,
    Separator: DropdownMenuSeparator,
    Shortcut: DropdownMenuShortcut,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
  },
  context: {
    Item: ContextMenuItem,
    CheckboxItem: ContextMenuCheckboxItem,
    RadioGroup: ContextMenuRadioGroup,
    RadioItem: ContextMenuRadioItem,
    Label: ContextMenuLabel,
    Separator: ContextMenuSeparator,
    Shortcut: ContextMenuShortcut,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
  },
}

function ActionMenuItem({ kind, action }: { kind: ActionMenuKind; action: Action }) {
  const { Item, CheckboxItem, RadioGroup, RadioItem, Shortcut, Sub, SubTrigger, SubContent } =
    parts[kind]
  const [tip, setTip] = useState(false)
  if (action.checked !== undefined)
    return (
      <CheckboxItem
        data-action={action.id}
        checked={action.checked}
        disabled={action.disabled}
        onCheckedChange={() => action.onSelect?.()}
        className="items-start"
      >
        {action.label}
      </CheckboxItem>
    )
  if (action.submenu)
    return (
      <Sub>
        <SubTrigger data-action={action.id} disabled={action.disabled}>
          {action.icon}
          {action.label}
          {action.extra}
        </SubTrigger>
        <SubContent className="max-h-80 overflow-y-auto">
          {action.submenu.every((choice) => choice.checked !== undefined) ? (
            <RadioGroup
              value={action.submenu.find((choice) => choice.checked)?.id ?? ''}
              onValueChange={(id) =>
                action.submenu?.find((choice) => choice.id === id)?.onSelect?.()
              }
            >
              {action.submenu.map((choice) => (
                <RadioItem
                  key={choice.id}
                  value={choice.id}
                  data-action={choice.id}
                  disabled={choice.disabled}
                >
                  {choice.icon}
                  {choice.label}
                </RadioItem>
              ))}
            </RadioGroup>
          ) : (
            action.submenu.map((choice) => (
              <ActionMenuItem key={choice.id} kind={kind} action={choice} />
            ))
          )}
        </SubContent>
      </Sub>
    )
  const tone = action.tone ?? (action.group === 'danger' ? 'destructive' : 'default')
  const reason = action.disabledReason
  const body = (
    <>
      {action.icon}
      {action.label}
      {action.extra}
      {action.shortcut && <Shortcut>{action.shortcut}</Shortcut>}
    </>
  )
  const item = (
    <Item
      data-action={action.id}
      data-tone={tone === 'default' ? undefined : tone}
      variant={tone === 'destructive' ? 'destructive' : 'default'}
      className={toneClass}
      disabled={action.disabled && !reason}
      aria-disabled={reason || action.disabled ? true : undefined}
      asChild={Boolean(action.href) && !reason}
      onSelect={(event) => {
        if (reason) return event.preventDefault()
        action.onSelect?.()
      }}
    >
      {action.href && !reason ? (
        <a href={action.href} download={action.download}>
          {body}
        </a>
      ) : (
        body
      )}
    </Item>
  )
  if (!reason) return item
  return (
    <TooltipProvider>
      <Tooltip open={tip} onOpenChange={setTip}>
        <TooltipTrigger asChild>{item}</TooltipTrigger>
        {/* Gone at once when closed: a tooltip fading out would still take the menu's Escape. */}
        {tip && <TooltipContent side="right">{reason}</TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  )
}

/** The actions in their fixed groups, a separator between non-empty groups only. */
export function ActionMenuItems({
  kind,
  actions,
}: {
  kind: ActionMenuKind
  actions: ActionMenuSpec['actions']
}) {
  const { Separator } = parts[kind]
  const shown = actions.filter((action): action is Action => Boolean(action))
  const groups = ACTION_GROUPS.map((group) => shown.filter((action) => action.group === group))
  return (
    <>
      {groups
        .filter((items) => items.length > 0)
        .map((items, index) => (
          <Fragment key={items[0]?.group}>
            {index > 0 && <Separator />}
            {items.map((action) => (
              <ActionMenuItem key={action.id} kind={kind} action={action} />
            ))}
          </Fragment>
        ))}
    </>
  )
}

/** The header line and the actions, for inside a menu's content. */
export function ActionMenuBody({ kind, menu }: { kind: ActionMenuKind; menu: ActionMenuSpec }) {
  const { Label } = parts[kind]
  return (
    <>
      {menu.header && <Label className={actionMenuHeaderClass}>{menu.header}</Label>}
      <ActionMenuItems kind={kind} actions={menu.actions} />
    </>
  )
}

/**
 * The menu's content: the same definition renders the "…" menu (`dropdown`) and the right-click
 * menu (`context`), so an item's two menus never differ.
 */
export function ActionMenuContent({
  kind,
  menu,
  align = 'end',
  className,
  onCloseAutoFocus,
}: {
  kind: ActionMenuKind
  menu: ActionMenuSpec
  /** Dropdown only. */
  align?: 'start' | 'center' | 'end'
  className?: string
  /** Dropdown only: e.g. keep focus in a form row rather than on the "…" button. */
  onCloseAutoFocus?: (event: Event) => void
}) {
  const body = <ActionMenuBody kind={kind} menu={menu} />
  return kind === 'dropdown' ? (
    <DropdownMenuContent
      align={align}
      className={cn('min-w-52', className)}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {body}
    </DropdownMenuContent>
  ) : (
    <ContextMenuContent className={cn('min-w-52', className)}>{body}</ContextMenuContent>
  )
}
