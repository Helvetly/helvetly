'use client'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, GripVertical, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { createContext, use, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { HelpTip } from '@/components/settings/help-tip'
import { translate } from '@/lib/i18n'

/** The soft colour of a figure: its icon tile and its small chart. */
export const TONES = {
  brand: { tile: 'bg-brand-surface text-brand', chart: 'text-brand-solid' },
  success: { tile: 'bg-success-surface text-success', chart: 'text-success-solid' },
  warning: { tile: 'bg-warning-surface text-warning', chart: 'text-warning-solid' },
  violet: { tile: 'bg-violet-surface text-violet', chart: 'text-violet-solid' },
  info: { tile: 'bg-info-surface text-info', chart: 'text-info-solid' },
}
export type Tone = keyof typeof TONES

/** A tinted icon tile, the same in every dashboard card. */
export function ToneTile({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        TONES[tone].tile,
      )}
    >
      <Icon className="size-[18px] stroke-[1.75]" />
    </span>
  )
}

/** What the customizable dashboard gives a card it lays out: its drag handle and drag state. */
export type CardDrag = {
  /** The card's registry id, the drop target the pointer is over. */
  id: string
  label: string
  dragging: boolean
  over: boolean
  handle: {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
    onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  }
}
export const CardDragContext = createContext<CardDrag | null>(null)

/** A grip in the card's left gutter: shown on hover or focus, so it never moves the title row. */
function DragHandle({ drag }: { drag: CardDrag }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={translate('dashboardMoveCard', { name: drag.label })}
          aria-describedby="dashboard-move-hint"
          className="absolute top-5 left-0 flex h-6 w-4 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity select-none group-hover/card:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing [@media(hover:none)]:opacity-60"
          {...drag.handle}
        >
          <GripVertical aria-hidden className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{translate('dashboardDragToMove')}</TooltipContent>
    </Tooltip>
  )
}

/** One dashboard card: a title row (icon, title, help, "View all") over its content. */
export function DashboardCard({
  title,
  icon,
  tone = 'brand',
  help,
  viewAll,
  actions,
  className,
  children,
}: {
  title: string
  icon: LucideIcon
  tone?: Tone
  /** Explains the card in a (?) tooltip. */
  help?: string
  /** Where "View all" goes; `label` names it for assistive tech. */
  viewAll?: { href: string; label: string }
  /** Controls in the title row, before "View all". */
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  const drag = use(CardDragContext)
  return (
    // A container: what a card shows follows its own width, wherever the page lays it out.
    <section
      data-dashboard-card={drag?.id}
      data-dragging={drag?.dragging || undefined}
      data-drop-target={drag?.over || undefined}
      className={cn(
        'group/card @container relative flex min-w-0 flex-col rounded-xl border bg-card transition-[opacity,border-color] duration-150 data-dragging:opacity-50 data-drop-target:border-dashed data-drop-target:border-brand data-drop-target:bg-brand-surface/30',
        className,
      )}
    >
      {drag && <DragHandle drag={drag} />}
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2">
        <ToneTile icon={icon} tone={tone} />
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-body font-medium">{title}</h2>
          {help && <HelpTip label={translate('aboutDynamic', { title })}>{help}</HelpTip>}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {actions}
          {viewAll && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="font-normal text-muted-foreground underline-offset-4 hover:underline"
            >
              <Link href={viewAll.href}>
                {translate('viewAll')}
                <span className="sr-only">: {viewAll.label}</span>
                <ArrowRight className="stroke-[1.5]" />
              </Link>
            </Button>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

/** One row of a card's list: a leading tile or avatar, title and meta, then whatever sits right. */
export const LIST_ROW =
  'flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-muted/60'
