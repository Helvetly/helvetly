'use client'
import { Button } from '@helvetly/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowDown, ArrowUp, Check, ChevronRight, Ellipsis, Layers, Plus, X } from 'lucide-react'

import {
  GROUP_DIM_LABELS,
  GROUP_DIMS,
  groupValue,
  MAX_GROUP_LEVELS,
  type DocType,
  type GroupDim,
  type ViewParams,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'

const DIM_NAMES: Record<GroupDim, string> = {
  type: translate('type'),
  year: translate('year'),
  client: translate('client'),
}

/** A grouping's name on the Group by button: Folders, or its levels in order (Client → Year). */
export function groupingLabel(dims: readonly GroupDim[]) {
  if (dims.length === 0) return translate('groupingFolders')
  return dims.map((dim) => DIM_NAMES[dim]).join(' → ')
}

/** Ready-made views at the top of Group by: a grouping with its first group chosen, e.g. invoices by year. */
export type ViewPreset = {
  id: 'folders' | 'invoices' | 'quotes' | 'receipts' | 'clients'
  label: string
  group: GroupDim[]
  type: DocType | null
}
export const VIEW_PRESETS: ViewPreset[] = [
  { id: 'folders', label: translate('groupingFolders'), group: [], type: null },
  {
    id: 'invoices',
    label: translate('viewInvoicesByYear'),
    group: ['type', 'year'],
    type: 'invoices',
  },
  { id: 'quotes', label: translate('viewQuotesByYear'), group: ['type', 'year'], type: 'quotes' },
  {
    id: 'receipts',
    label: translate('viewReceiptsByYear'),
    group: ['type', 'year'],
    type: 'receipts',
  },
  { id: 'clients', label: translate('groupByClient'), group: ['client'], type: null },
]

/** Whether the view is (inside) a preset. */
export const inPreset = (view: ViewParams, preset: ViewPreset) =>
  view.section === 'files' && view.group.join() === preset.group.join() && view.type === preset.type

/** One level moved by step (-1 up, 1 down) in the grouping. */
export function moveLevel(group: readonly GroupDim[], index: number, step: -1 | 1): GroupDim[] {
  const next = [...group]
  const target = index + step
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

type PanelProps = {
  view: ViewParams
  /** Each preset's file count (a client preset: its clients), when known. */
  counts: Partial<Record<ViewPreset['id'], number>>
  onPreset: (preset: ViewPreset) => void
  /** The grouping's levels changed (the chosen groups stay as filters). */
  onChange: (group: GroupDim[]) => void
}

function LevelButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="cursor-pointer text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Group by's popover: the presets, then the levels to combine in any order (Client → Year). */
export function GroupByPanel({ view, counts, onPreset, onChange }: PanelProps) {
  const group = view.group
  const free = GROUP_DIMS.filter((dim) => !group.includes(dim))
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <p className="px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground">
          {translate('groupingViews')}
        </p>
        {VIEW_PRESETS.map((preset) => {
          const current = inPreset(view, preset)
          const count = counts[preset.id]
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={current}
              onClick={() => onPreset(preset)}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm text-foreground/80 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:font-medium aria-pressed:text-foreground"
            >
              <Check className={cn('size-4 shrink-0', !current && 'invisible')} />
              <span className="min-w-0 flex-1 truncate">{preset.label}</span>
              {count !== undefined && count > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="grid gap-1 border-t pt-2">
        <p className="px-2 pb-0.5 text-xs font-medium text-muted-foreground">
          {translate('groupingLevels')}
        </p>
        {group.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">{translate('groupingLevelsEmpty')}</p>
        )}
        <ol aria-label={translate('groupingLevels')} className="grid gap-0.5">
          {group.map((dim, index) => (
            <li key={dim} className="flex h-8 items-center gap-1 rounded-lg pr-0.5 pl-2 text-sm">
              <span className="w-4 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{DIM_NAMES[dim]}</span>
              <LevelButton
                label={translate('groupingMoveUp', { level: DIM_NAMES[dim] })}
                disabled={index === 0}
                onClick={() => onChange(moveLevel(group, index, -1))}
              >
                <ArrowUp />
              </LevelButton>
              <LevelButton
                label={translate('groupingMoveDown', { level: DIM_NAMES[dim] })}
                disabled={index === group.length - 1}
                onClick={() => onChange(moveLevel(group, index, 1))}
              >
                <ArrowDown />
              </LevelButton>
              <LevelButton
                label={translate('groupingRemove', { level: DIM_NAMES[dim] })}
                onClick={() => onChange(group.filter((other) => other !== dim))}
              >
                <X />
              </LevelButton>
            </li>
          ))}
        </ol>
        {group.length < MAX_GROUP_LEVELS && (
          <div className="flex flex-wrap gap-1 px-1 pt-0.5">
            {free.map((dim) => (
              <Button
                key={dim}
                variant="outline"
                size="xs"
                onClick={() => onChange([...group, dim])}
                className="cursor-pointer gap-1 font-normal"
              >
                <Plus />
                {DIM_NAMES[dim]}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** "Group by" beside Filters and sort; on phones its button is a "…". */
export function GroupByMenu(props: PanelProps) {
  const label = groupingLabel(props.view.group)
  const triggers = [
    <Button
      key="wide"
      variant="outline"
      size="sm"
      aria-label={`${translate('groupBy')}: ${label}`}
      className="cursor-pointer gap-1.5 font-normal text-foreground/80 max-sm:hidden"
    >
      <Layers className="stroke-[1.5]" />
      <span className="max-lg:sr-only">{label}</span>
    </Button>,
    <Button
      key="phone"
      variant="ghost"
      size="icon-sm"
      aria-label={`${translate('groupBy')}: ${label}`}
      className="cursor-pointer text-muted-foreground sm:hidden"
    >
      <Ellipsis />
    </Button>,
  ]
  return triggers.map((trigger) => (
    <Popover key={trigger.key}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{translate('groupBy')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" aria-label={translate('groupBy')} className="w-64 p-1.5">
        <GroupByPanel {...props} />
      </PopoverContent>
    </Popover>
  ))
}

/** The breadcrumb of a grouped view: All documents › By type › Invoices › 2026. */
export function GroupCrumbs({
  view,
  label,
  onFolders,
  onLevel,
}: {
  view: ViewParams
  /** A chosen group's name. */
  label: (dim: GroupDim, key: string) => string
  /** Back to the folders. */
  onFolders: () => void
  /** Back to a level: the groups of view.group[index] (0 = the grouping's top). */
  onLevel: (index: number) => void
}) {
  const chosen = view.group.flatMap((dim) => {
    const value = groupValue(view, dim)
    return value === null ? [] : [{ dim, value }]
  })
  const [first] = view.group
  const crumbs = [
    { key: 'folders', label: translate('allDocuments'), onClick: onFolders },
    ...(first
      ? [{ key: 'grouping', label: GROUP_DIM_LABELS[first], onClick: () => onLevel(0) }]
      : []),
    ...chosen.map(({ dim, value }, index) => ({
      key: dim,
      label: label(dim, value),
      onClick: () => onLevel(index + 1),
    })),
  ]
  return (
    <nav
      aria-label={translate('breadcrumbs')}
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      {crumbs.map((crumb, index) => (
        <span key={crumb.key} className="flex min-w-0 items-center gap-0.5">
          {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />}
          <button
            type="button"
            aria-current={index === crumbs.length - 1 ? 'page' : undefined}
            onClick={crumb.onClick}
            title={crumb.label}
            className="h-8 min-w-0 cursor-pointer truncate rounded-md px-2 text-title-sm text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  )
}
