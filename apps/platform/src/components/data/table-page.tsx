'use client'
import { type Action, ActionMenuContent } from '@helvetly/ui/components/action-menu'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronDown, X } from 'lucide-react'
import { type ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { useCanWriteHere } from '@/lib/permissions'

const bulkIcon =
  'flex size-8 items-center justify-center rounded-md text-white/85 transition-colors duration-150 hover:bg-white/10 hover:text-white [&_svg]:size-[18px] [&_svg]:stroke-[1.6]'

// The bar is always dark, so the light theme's red would be too dim on it.
const bulkDestructive = 'text-red-400 hover:bg-red-500/15 hover:text-red-300'

function Divider() {
  return <span aria-hidden className="h-4 w-px bg-white/20" />
}

export type BulkAction = {
  label: string
  icon: ReactNode
  onClick: () => void
  /** Goes last, apart and in red; also last, in red, in a row's right-click menu. */
  destructive?: boolean
  /** Changes records: hidden from a member without write on the page's resource. */
  write?: boolean
  /** Why the action cannot run now: shown in its tooltip, the button stays focusable. */
  disabled?: string
  /**
   * Paired or related actions (Activate / Deactivate, Mark paid / unpaid) share one menu button
   * named by the group; a group left with one action shows it as a plain button.
   */
  group?: BulkGroup
}

export type BulkGroup = { label: string; icon: ReactNode }

type BulkEntry =
  | { kind: 'action'; action: BulkAction }
  | { kind: 'group'; group: BulkGroup; actions: BulkAction[] }

/** The actions a member may run, groups gathered where their first action stood, destructive last. */
export function bulkEntries(actions: BulkAction[], writable: boolean): BulkEntry[] {
  const allowed = actions.filter((action) => writable || !action.write)
  const ordered = [
    ...allowed.filter((action) => !action.destructive),
    ...allowed.filter((action) => action.destructive),
  ]
  const entries: BulkEntry[] = []
  for (const action of ordered) {
    const group = action.group
    const existing = group
      ? entries.find((entry) => entry.kind === 'group' && entry.group.label === group.label)
      : undefined
    if (existing?.kind === 'group') existing.actions.push(action)
    else if (group) entries.push({ kind: 'group', group, actions: [action] })
    else entries.push({ kind: 'action', action })
  }
  return entries.map((entry) =>
    entry.kind === 'group' && entry.actions.length === 1
      ? { kind: 'action', action: entry.actions[0]! }
      : entry,
  )
}

/** A bulk action as an item of an action menu. */
export function bulkMenuAction(action: BulkAction): Action {
  return {
    id: action.label,
    group: action.destructive ? 'danger' : 'edit',
    label: action.label,
    icon: action.icon,
    onSelect: action.onClick,
    disabledReason: action.disabled,
  }
}

/** The floating dark bar while rows are selected: the count, then the actions as icon buttons. */
export function BulkBar({
  count,
  actions,
  onClear,
}: {
  count: number
  actions: BulkAction[]
  onClear: () => void
}) {
  const writable = useCanWriteHere()
  return (
    <div className="pointer-events-none sticky bottom-5 z-30 mt-auto flex animate-in justify-center gap-2 px-4 pt-6 duration-200 fade-in slide-in-from-bottom-2">
      <button
        type="button"
        aria-label={translate('clearSelection')}
        onClick={onClear}
        className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-elevation-2 transition-colors duration-150 hover:bg-zinc-800 dark:bg-zinc-800"
      >
        <X className="size-[18px]" />
      </button>
      <div
        role="toolbar"
        aria-label={translate('selectedRows')}
        className="pointer-events-auto flex min-h-11 min-w-0 flex-wrap items-center justify-center gap-x-1 gap-y-0.5 rounded-xl bg-zinc-900 px-2 py-1 text-[15px] text-white shadow-elevation-2 sm:gap-x-2 sm:px-4 dark:bg-zinc-800"
      >
        <span className="pr-1 whitespace-nowrap tabular-nums">
          {translate('selected')}
          {count}
        </span>
        {bulkEntries(actions, writable).map((entry) => {
          const key = entry.kind === 'group' ? entry.group.label : entry.action.label
          const apart = entry.kind === 'action' && entry.action.destructive
          return (
            <span key={key} className="contents">
              {apart ? <span aria-hidden className="w-1 sm:w-2" /> : null}
              <Divider />
              {entry.kind === 'group' ? (
                <BulkGroupButton group={entry.group} actions={entry.actions} />
              ) : (
                <BulkButton action={entry.action} />
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function BulkButton({
  action: { label, icon, onClick, destructive, disabled },
}: {
  action: BulkAction
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-disabled={Boolean(disabled)}
          className={cn(
            bulkIcon,
            destructive && bulkDestructive,
            disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
          )}
          onClick={disabled ? undefined : onClick}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">
        {disabled ? `${label}: ${disabled}` : label}
      </TooltipContent>
    </Tooltip>
  )
}

/** A group's button: its icon and name (the name from sm up), opening its actions above the bar. */
function BulkGroupButton({ group, actions }: { group: BulkGroup; actions: BulkAction[] }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={group.label}
              className={cn(bulkIcon, 'w-auto gap-1.5 px-2 text-sm data-[state=open]:bg-white/10')}
            >
              {group.icon}
              <span className="hidden sm:inline">{group.label}</span>
              <ChevronDown aria-hidden className="size-3.5! text-white/60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{group.label}</TooltipContent>
      </Tooltip>
      <ActionMenuContent
        kind="dropdown"
        align="center"
        className="min-w-44"
        menu={{ actions: actions.map(bulkMenuAction) }}
      />
    </DropdownMenu>
  )
}

export function State({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode
  title: string
  text: string
  /** Left out where the page header already holds the action. */
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="grid max-w-sm animate-in justify-items-center text-center duration-300 fade-in slide-in-from-bottom-1">
        <div aria-hidden className="relative mb-7 h-24 w-48">
          <div className="absolute -inset-x-14 -inset-y-10 bg-[radial-gradient(var(--border)_1px,transparent_1px)] mask-[radial-gradient(closest-side,black,transparent)] bg-size-[14px_14px]" />
          <GhostCard className="top-3 left-0 -rotate-[8deg]" />
          <GhostCard className="top-3 right-0 rotate-[8deg]" />
          <span className="absolute top-1/2 left-1/2 flex size-14 -translate-1/2 items-center justify-center rounded-2xl bg-card text-foreground shadow-[0_10px_30px_-8px_rgb(0_0_0/0.18),0_2px_6px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.04] dark:ring-foreground/10 [&_svg]:size-6 [&_svg]:stroke-[1.5]">
            {icon}
          </span>
        </div>
        <p className="text-[17px] font-medium tracking-[-0.01em] text-balance">{title}</p>
        <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{text}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}

/** A blank record card behind an empty state's icon: a hint of the rows that will appear here. */
function GhostCard({ className }: { className: string }) {
  return (
    <span
      className={cn(
        'absolute grid h-16 w-24 content-center gap-1.5 rounded-xl bg-card px-3 shadow-elevation-1',
        className,
      )}
    >
      <span className="size-3.5 rounded-full bg-muted" />
      <span className="h-1.5 w-14 rounded-full bg-muted" />
      <span className="h-1.5 w-9 rounded-full bg-muted" />
    </span>
  )
}

export function LoadingRows() {
  return <Loader className="min-h-112" />
}
