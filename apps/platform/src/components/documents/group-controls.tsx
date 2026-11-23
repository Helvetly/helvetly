'use client'
import { Button } from '@helvetly/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Ellipsis,
  Folder,
  Layers,
  Plus,
  X,
} from 'lucide-react'

import { NativeSelect } from '@/components/clients/fields'
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

/** A grouping's name on the Group by button: Folders, or its levels in order (Client › Year). */
export function groupingLabel(dims: readonly GroupDim[]) {
  if (dims.length === 0) return translate('groupingFolders')
  return dims.map((dim) => DIM_NAMES[dim]).join(' › ')
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

const FOLDERS = VIEW_PRESETS[0]!

/** A grouping in plain words: "Files grouped by client, then by year inside each client." */
export function groupingSentence(dims: readonly GroupDim[]) {
  const [first, second, third] = dims.map((dim) => DIM_WORDS[dim])
  if (!first) return translate('groupingPreviewNone')
  if (!second) return translate('groupingPreviewOne', { first })
  if (!third) return translate('groupingPreviewTwo', { first, second })
  return translate('groupingPreviewThree', { first, second, third })
}

const DIM_WORDS: Record<GroupDim, string> = {
  type: translate('groupingWordType'),
  year: translate('groupingWordYear'),
  client: translate('groupingWordClient'),
}

function IconButton({
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

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  )
}

/** One "Show as" choice: its name, a muted line under it, a check when it is the open view. */
function ViewRow({
  title,
  detail,
  current,
  onClick,
}: {
  title: string
  detail: string
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={current}
      onClick={onClick}
      className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent"
    >
      <Check className={cn('mt-0.5 size-4 shrink-0', !current && 'invisible')} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  )
}

function presetDetail(preset: ViewPreset, count: number | undefined) {
  const path = groupingLabel(preset.group)
  if (count === undefined || count === 0) return path
  const amount =
    preset.id === 'clients'
      ? translate('groupingClients', { count })
      : translate('groupFiles', { count })
  return `${path} · ${amount}`
}

/** Group by's popover: Folders (the default) or a ready grouping, a custom grouping's levels, and the reset. */
export function GroupByPanel({ view, counts, onPreset, onChange }: PanelProps) {
  const group = view.group
  const free = GROUP_DIMS.filter((dim) => !group.includes(dim))
  const full = group.length >= MAX_GROUP_LEVELS || free.length === 0
  // Folders is the default whatever the filters; choosing it again also clears a preset's filters
  const atDefault = group.length === 0
  // aria-disabled, not disabled: the button stays focusable so its tooltip says why
  const addLevel = (
    <Button
      variant="ghost"
      size="sm"
      aria-disabled={full}
      onClick={() => {
        if (!full) onChange([...group, free[0]!])
      }}
      className="cursor-pointer justify-start gap-1.5 font-normal text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
    >
      <Plus />
      {translate('groupingAddLevel')}
    </Button>
  )
  return (
    <div className="grid gap-2">
      <fieldset aria-labelledby="group-by-show-as" className="grid min-w-0 gap-0.5">
        <SectionTitle id="group-by-show-as">{translate('groupingShowAs')}</SectionTitle>
        <ViewRow
          title={translate('groupingFoldersDefault')}
          detail={translate('groupingFoldersHint')}
          current={atDefault}
          onClick={() => onPreset(FOLDERS)}
        />
        <SectionTitle id="group-by-grouped">{translate('groupingGrouped')}</SectionTitle>
        {VIEW_PRESETS.slice(1).map((preset) => (
          <ViewRow
            key={preset.id}
            title={preset.label}
            detail={presetDetail(preset, counts[preset.id])}
            current={inPreset(view, preset)}
            onClick={() => onPreset(preset)}
          />
        ))}
      </fieldset>
      <fieldset aria-labelledby="group-by-custom" className="grid min-w-0 gap-1 border-t pt-2">
        <SectionTitle id="group-by-custom">{translate('groupingCustom')}</SectionTitle>
        <ol aria-label={translate('groupingLevels')} className="grid gap-1">
          {group.map((dim, index) => {
            const name = DIM_NAMES[dim]
            return (
              <li key={dim} className="flex items-center gap-1 pl-2">
                <span aria-hidden className="w-4 text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <NativeSelect
                  aria-label={translate('groupingLevel', { step: index + 1 })}
                  value={dim}
                  onChange={(event) => {
                    const chosen = GROUP_DIMS.find((other) => other === event.target.value)
                    if (chosen) onChange(group.map((other, at) => (at === index ? chosen : other)))
                  }}
                  wrapperClassName="flex-1"
                >
                  {GROUP_DIMS.filter((other) => other === dim || free.includes(other)).map(
                    (other) => (
                      <option key={other} value={other}>
                        {DIM_NAMES[other]}
                      </option>
                    ),
                  )}
                </NativeSelect>
                <IconButton
                  label={translate('groupingMoveUp', { level: name })}
                  disabled={index === 0}
                  onClick={() => onChange(moveLevel(group, index, -1))}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label={translate('groupingMoveDown', { level: name })}
                  disabled={index === group.length - 1}
                  onClick={() => onChange(moveLevel(group, index, 1))}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label={translate('groupingRemove', { level: name })}
                  onClick={() => onChange(group.filter((other) => other !== dim))}
                >
                  <X />
                </IconButton>
              </li>
            )
          })}
        </ol>
        {full ? (
          <Tooltip>
            <TooltipTrigger asChild>{addLevel}</TooltipTrigger>
            <TooltipContent>{translate('groupingAddLevelFull')}</TooltipContent>
          </Tooltip>
        ) : (
          addLevel
        )}
        <p aria-live="polite" className="px-2 pb-0.5 text-xs text-muted-foreground">
          {groupingSentence(group)}
        </p>
      </fieldset>
      <div className="border-t px-1 pt-1.5 pb-0.5">
        <Button
          variant="link"
          size="sm"
          disabled={atDefault}
          onClick={() => onPreset(FOLDERS)}
          className="h-auto cursor-pointer px-1 py-0.5 font-normal"
        >
          {translate('groupingReset')}
        </Button>
      </div>
    </div>
  )
}

/** "Group: Folders" or "Group: Client › Year" beside Filters and sort; on phones its button is a "…". */
export function GroupByMenu(props: PanelProps) {
  const grouped = props.view.group.length > 0
  const label = translate('groupingButton', { grouping: groupingLabel(props.view.group) })
  const Icon = grouped ? Layers : Folder
  // a dot says the list is not in its default folders
  const dot = grouped && (
    <span aria-hidden data-grouped-dot className="size-1.5 shrink-0 rounded-full bg-primary" />
  )
  const triggers = [
    <Button
      key="wide"
      variant="outline"
      size="sm"
      aria-label={label}
      className="cursor-pointer gap-1.5 font-normal text-foreground/80 max-sm:hidden"
    >
      <Icon className="stroke-[1.5]" />
      <span className="max-lg:sr-only">{label}</span>
      {dot}
    </Button>,
    <Button
      key="phone"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className="relative cursor-pointer text-muted-foreground sm:hidden"
    >
      <Ellipsis />
      {grouped && (
        <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
      )}
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
      <PopoverContent align="end" aria-label={translate('groupBy')} className="w-80 p-1.5">
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
