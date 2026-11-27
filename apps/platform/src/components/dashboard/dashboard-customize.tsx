'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal } from 'lucide-react'
import {
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

import { EngagementsCard } from '@/components/engagements/engagements-card'
import { TodayCard } from '@/components/scheduling/today-card'
import { translate } from '@/lib/i18n'
import type { Need } from '@/lib/permissions'

import { NeedsAttention } from './attention-card'
import { CashFlowCard, YearOverYearCard } from './cash-flow-card'
import { CardDragContext } from './dashboard-card'
import { moveDashboardCard, type DashboardLayout } from './dashboard-layout'
import { SpendingCard } from './spending-card'

export type DashboardCardEntry = {
  id: string
  label: string
  Component: ComponentType<{ className?: string }>
  /** The card's share of a row: wide charts, medium lists, small cards in equal thirds. */
  width: string
  /** Shown to anyone with one of these permissions. */
  requiresAny: readonly Need[]
}

const WIDE = 'flex-[7_1_520px]'
const MEDIUM = 'flex-[5_1_360px]'
const SMALL = 'flex-[1_1_340px]'

/** Every card below the key figures, in its default order. A new card joins saved layouts at its place here. */
export const DASHBOARD_CARDS: readonly DashboardCardEntry[] = [
  {
    id: 'cash-flow',
    label: translate('cashFlow'),
    Component: CashFlowCard,
    width: WIDE,
    requiresAny: ['read:invoices', 'read:expenses'],
  },
  {
    id: 'attention',
    label: translate('needsAttention'),
    Component: NeedsAttention,
    width: MEDIUM,
    requiresAny: ['read:invoices', 'read:periods', 'read:vat-return'],
  },
  {
    id: 'year-over-year',
    label: translate('yearOverYear'),
    Component: YearOverYearCard,
    width: WIDE,
    requiresAny: ['read:invoices', 'read:expenses'],
  },
  {
    id: 'spending',
    label: translate('spendingByCategory'),
    Component: SpendingCard,
    width: MEDIUM,
    requiresAny: ['read:expenses'],
  },
  {
    id: 'today',
    label: translate('schedToday'),
    Component: TodayCard,
    width: SMALL,
    requiresAny: ['read:scheduling'],
  },
  {
    id: 'engagements',
    label: translate('engagements'),
    Component: EngagementsCard,
    width: SMALL,
    requiresAny: ['read:engagements'],
  },
]
export const DEFAULT_CARD_ORDER = DASHBOARD_CARDS.map(({ id }) => id)

/** The card under the pointer, by its `data-dashboard-card`. */
function cardAt(event: PointerEvent) {
  const element = document.elementFromPoint(event.clientX, event.clientY)
  return element?.closest<HTMLElement>('[data-dashboard-card]')?.dataset.dashboardCard
}

/**
 * The cards in the person's order, each draggable by its grip onto another card's place; the grip's
 * arrow keys move it one place. Moves are announced for screen readers.
 */
export function DashboardGrid({
  cards,
  layout,
  onChange,
}: {
  /** The visible cards, in order. */
  cards: readonly DashboardCardEntry[]
  layout: DashboardLayout
  onChange: (layout: DashboardLayout) => void
}) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const grid = useRef<HTMLDivElement>(null)
  // A card with nothing to show (Today on a quiet day) renders nothing: only drawn cards count as places.
  const drawn = () =>
    [...(grid.current?.querySelectorAll<HTMLElement>(':scope > [data-dashboard-card]') ?? [])].map(
      (element) => element.dataset.dashboardCard,
    )
  const move = (card: DashboardCardEntry, target: string | undefined) => {
    if (!target) return
    const order = moveDashboardCard(layout.order, card.id, target)
    if (order === layout.order) return
    onChange({ ...layout, order })
    const places = drawn()
    setAnnouncement(
      translate('dashboardCardMoved', {
        name: card.label,
        position: places.indexOf(target) + 1,
        total: places.length,
      }),
    )
  }
  const end = () => {
    setDragging(null)
    setOver(null)
  }

  return (
    <div ref={grid} className="flex flex-wrap gap-4">
      {cards.map((card) => (
        <CardDragContext
          key={card.id}
          value={{
            id: card.id,
            label: card.label,
            dragging: dragging === card.id,
            over: dragging !== null && dragging !== card.id && over === card.id,
            handle: {
              onPointerDown: (event) => {
                if (!event.isPrimary || event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                setDragging(card.id)
              },
              onPointerMove: (event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  setOver(cardAt(event) ?? null)
              },
              onPointerUp: (event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                end()
                move(card, cardAt(event))
              },
              onLostPointerCapture: end,
              onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key]
                if (!step) return
                event.preventDefault()
                const places = drawn()
                const target = places[places.indexOf(card.id) + step]
                const handle = event.currentTarget
                move(card, target)
                // The card re-renders in its new place; keep the keyboard on its grip.
                requestAnimationFrame(() => handle.focus())
              },
            },
          }}
        >
          <card.Component className={`min-w-0 ${card.width}`} />
        </CardDragContext>
      ))}
      <p id="dashboard-move-hint" className="sr-only">
        {translate('dashboardMoveHint')}
      </p>
      <output className="sr-only">{announcement}</output>
    </div>
  )
}

/** "Customize": which cards show and their order, by drag or arrows; reset brings the default back. */
export function DashboardCustomize({
  cards,
  layout,
  onChange,
}: {
  /** Every card this person may see, visible or not, in order. */
  cards: readonly DashboardCardEntry[]
  layout: DashboardLayout
  onChange: (layout: DashboardLayout | null) => void
}) {
  const id = useId()
  const [announcement, setAnnouncement] = useState('')
  const changed =
    layout.hidden.length > 0 || layout.order.some((card, i) => card !== DEFAULT_CARD_ORDER[i])
  const move = (card: DashboardCardEntry, target: string | undefined) => {
    if (!target) return
    onChange({ ...layout, order: moveDashboardCard(layout.order, card.id, target) })
    setAnnouncement(
      translate('dashboardCardMoved', {
        name: card.label,
        position: cards.findIndex((entry) => entry.id === target) + 1,
        total: cards.length,
      }),
    )
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" className="font-normal">
              <SlidersHorizontal aria-hidden className="stroke-[1.5] text-muted-foreground" />
              <span className="@max-[40rem]:sr-only">{translate('customize')}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{translate('dashboardCustomizeTip')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" aria-label={translate('customize')} className="w-80 gap-2 p-2">
        <div className="grid gap-0.5 px-2 pt-1">
          <p className="text-body-sm font-medium">{translate('dashboardCards')}</p>
          <p className="text-xs text-muted-foreground">{translate('dashboardReorderCards')}</p>
        </div>
        <ol className="grid">
          {cards.map((card, index) => {
            const checkboxId = `${id}-${card.id}`
            const shown = !layout.hidden.includes(card.id)
            return (
              <li
                key={card.id}
                className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-muted/60"
              >
                <Checkbox
                  id={checkboxId}
                  checked={shown}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...layout,
                      hidden:
                        checked === true
                          ? layout.hidden.filter((hidden) => hidden !== card.id)
                          : [...layout.hidden, card.id],
                    })
                  }
                />
                <label
                  htmlFor={checkboxId}
                  className="min-w-0 flex-1 cursor-pointer truncate py-1.5 text-body-sm data-[shown=false]:text-muted-foreground"
                  data-shown={shown}
                >
                  {card.label}
                </label>
                {(
                  [
                    [-1, ArrowUp, 'dashboardMoveCardUp'],
                    [1, ArrowDown, 'dashboardMoveCardDown'],
                  ] as const
                ).map(([offset, Icon, label]) => {
                  const target = cards[index + offset]?.id
                  const name = translate(label, { name: card.label })
                  return (
                    <Tooltip key={label}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={name}
                          aria-disabled={target === undefined}
                          className="text-muted-foreground aria-disabled:pointer-events-none aria-disabled:opacity-30"
                          onClick={() => move(card, target)}
                        >
                          <Icon aria-hidden className="stroke-[1.5]" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{name}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </li>
            )
          })}
        </ol>
        <output className="sr-only">{announcement}</output>
        <div className="border-t px-1 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!changed}
            className="font-normal text-muted-foreground"
            onClick={() => {
              onChange(null)
              setAnnouncement(translate('dashboardLayoutReset'))
            }}
          >
            <RotateCcw aria-hidden className="stroke-[1.5]" />
            {translate('dashboardResetLayout')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
