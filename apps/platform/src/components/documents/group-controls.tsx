'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { ChevronRight, Ellipsis, Layers } from 'lucide-react'

import {
  GROUP_DIM_LABELS,
  GROUPINGS,
  groupValue,
  type DocType,
  type GroupDim,
  type ViewParams,
} from '@/lib/documents'
import { translate } from '@/lib/i18n'

/** A grouping's name in the Group by menu. */
export function groupingLabel(dims: readonly GroupDim[]) {
  const key = dims.join()
  if (key === '') return translate('groupingFolders')
  if (key === 'type,year') return translate('groupingTypeYear')
  if (key === 'year,type') return translate('groupingYearType')
  return translate(key === 'type' ? 'type' : key === 'year' ? 'year' : 'client')
}

/** The sidebar's Views: a grouping with its first group chosen, e.g. invoices by year. */
export type ViewPreset = {
  id: 'invoices' | 'quotes' | 'receipts' | 'clients'
  label: string
  group: GroupDim[]
  type: DocType | null
}
export const VIEW_PRESETS: ViewPreset[] = [
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

function GroupingItems({
  group,
  onChange,
}: {
  group: readonly GroupDim[]
  onChange: (group: GroupDim[]) => void
}) {
  return (
    <DropdownMenuRadioGroup
      value={group.join()}
      onValueChange={(value) =>
        onChange(GROUPINGS.find((grouping) => grouping.join() === value)?.slice() ?? [])
      }
    >
      {GROUPINGS.map((grouping) => (
        <DropdownMenuRadioItem key={grouping.join()} value={grouping.join()}>
          {groupingLabel(grouping)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** "Group by" beside Filters and sort; on phones it moves into the toolbar's "…" menu. */
export function GroupByMenu({
  group,
  onChange,
}: {
  group: readonly GroupDim[]
  onChange: (group: GroupDim[]) => void
}) {
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label={`${translate('groupBy')}: ${groupingLabel(group)}`}
                className="cursor-pointer gap-1.5 font-normal text-foreground/80 max-sm:hidden"
              >
                <Layers className="stroke-[1.5]" />
                <span className="max-lg:sr-only">{groupingLabel(group)}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{translate('groupBy')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>{translate('groupBy')}</DropdownMenuLabel>
          <GroupingItems group={group} onChange={onChange} />
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('moreActions')}
                className="cursor-pointer text-muted-foreground sm:hidden"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{translate('moreActions')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel>{translate('groupBy')}</DropdownMenuLabel>
          <GroupingItems group={group} onChange={onChange} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
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
