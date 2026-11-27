'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal } from 'lucide-react'
import {
  useId,
  useLayoutEffect,
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
import {
  moveDashboardCard,
  packDashboardRows,
  passesMiddle,
  type CardSpan,
  type DashboardLayout,
} from './dashboard-layout'
import { SpendingCard } from './spending-card'

export type DashboardCardEntry = {
  id: string
  label: string
  Component: ComponentType<{ className?: string }>
  /** The card's share of a 12-column row: charts prefer two thirds and take at least half, lists a third. */
  span: CardSpan
  /** Shown to anyone with one of these permissions. */
  requiresAny: readonly Need[]
}

const CHART: CardSpan = { min: 6, preferred: 8 }
const LIST: CardSpan = { min: 4, preferred: 4 }
// Whole class names, so Tailwind sees each span.
const SPANS: Record<number, string> = {
  1: '@4xl/dashboard:col-span-1',
  2: '@4xl/dashboard:col-span-2',
  3: '@4xl/dashboard:col-span-3',
  4: '@4xl/dashboard:col-span-4',
  5: '@4xl/dashboard:col-span-5',
  6: '@4xl/dashboard:col-span-6',
  7: '@4xl/dashboard:col-span-7',
  8: '@4xl/dashboard:col-span-8',
  9: '@4xl/dashboard:col-span-9',
  10: '@4xl/dashboard:col-span-10',
  11: '@4xl/dashboard:col-span-11',
  12: '@4xl/dashboard:col-span-12',
}

/** Every card below the key figures, in its default order. A new card joins saved layouts at its place here. */
export const DASHBOARD_CARDS: readonly DashboardCardEntry[] = [
  {
    id: 'cash-flow',
    label: translate('cashFlow'),
    Component: CashFlowCard,
    span: CHART,
    requiresAny: ['read:invoices', 'read:expenses'],
  },
  {
    id: 'attention',
    label: translate('needsAttention'),
    Component: NeedsAttention,
    span: LIST,
    requiresAny: ['read:invoices', 'read:periods', 'read:vat-return'],
  },
  {
    id: 'year-over-year',
    label: translate('yearOverYear'),
    Component: YearOverYearCard,
    span: CHART,
    requiresAny: ['read:invoices', 'read:expenses'],
  },
  {
    id: 'spending',
    label: translate('spendingByCategory'),
    Component: SpendingCard,
    span: LIST,
    requiresAny: ['read:expenses'],
  },
  {
    id: 'today',
    label: translate('schedToday'),
    Component: TodayCard,
    span: LIST,
    requiresAny: ['read:scheduling'],
  },
  {
    id: 'engagements',
    label: translate('engagements'),
    Component: EngagementsCard,
    span: LIST,
    requiresAny: ['read:engagements'],
  },
]
export const DEFAULT_CARD_ORDER = DASHBOARD_CARDS.map(({ id }) => id)

const CARD = '[data-dashboard-card]'
const idOf = (element: Element | null | undefined) =>
  element?.closest<HTMLElement>(CARD)?.dataset.dashboardCard
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A card being moved: by pointer it follows as a ghost, by keyboard it moves place by place. */
type Lift = { id: string; order: string[]; by: 'pointer' | 'keyboard' }

/** A see-through copy of the card that follows the pointer while the card's place shows where it drops. */
function makeGhost(card: HTMLElement) {
  const rect = card.getBoundingClientRect()
  const ghost = card.cloneNode(true)
  if (!(ghost instanceof HTMLElement)) throw new Error('Dashboard card did not clone as an element')
  for (const element of [ghost, ...ghost.querySelectorAll('[id]')]) element.removeAttribute('id')
  ghost.removeAttribute('data-dashboard-card')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    zIndex: '60',
    pointerEvents: 'none',
    opacity: '0.85',
    cursor: 'grabbing',
    outline: '1px solid color-mix(in oklab, var(--ring) 45%, transparent)',
  })
  document.body.append(ghost)
  return ghost
}

/**
 * The cards in the person's order, each draggable by its grip: a ghost follows the pointer, the card's
 * place (a dashed outline of its size) moves to where it will drop and the other cards slide to make
 * room. By keyboard, Space picks the card up, the arrows move it, Space drops and Escape cancels; the
 * arrows alone move it one place at once. Every step is announced for screen readers.
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
  const [lift, setLiftState] = useState<Lift | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Cards with nothing to show (Today on a quiet day) render nothing and take no place in a row.
  const [blank, setBlank] = useState<string[]>([])
  const grid = useRef<HTMLDivElement>(null)
  const order = lift?.order ?? layout.order
  const spans = new Map(
    packDashboardRows(
      cards
        .filter((card) => !blank.includes(card.id))
        .toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        .map((card) => ({ id: card.id, ...card.span })),
    )
      .flat()
      .map(({ id, span }) => [id, span]),
  )
  // Window listeners read the latest values, not the render they were added in.
  const latest = useRef({ lift, layout, onChange })
  useLayoutEffect(() => {
    latest.current = { lift, layout, onChange }
  })
  // Where each card was on screen before a change, so the change can slide them instead of jumping.
  const before = useRef<Map<string, DOMRect> | null>(null)
  const elements = () => [
    ...(grid.current?.querySelectorAll<HTMLElement>(`:scope > ${CARD}`) ?? []),
  ]
  const setLift = (next: Lift | null) => {
    before.current = new Map(
      elements().map((element) => [idOf(element) ?? '', element.getBoundingClientRect()]),
    )
    latest.current.lift = next
    setLiftState(next)
  }
  // A card with nothing to show (Today on a quiet day) renders nothing: only drawn cards count as places.
  const places = (ids: readonly string[]) => {
    const drawn = new Set(elements().map(idOf))
    return ids.filter((id) => drawn.has(id))
  }
  const say = (
    key:
      | 'dashboardCardMoved'
      | 'dashboardCardPickedUp'
      | 'dashboardCardDropped'
      | 'dashboardCardMoveCancelled',
    card: DashboardCardEntry,
    ids: readonly string[],
  ) => {
    const shown = places(ids)
    setAnnouncement(
      translate(key, {
        name: card.label,
        position: shown.indexOf(card.id) + 1,
        total: shown.length,
      }),
    )
  }
  const commit = (next: string[]) => {
    const { layout: current, onChange: change } = latest.current
    if (next.some((id, i) => id !== current.order[i])) change({ ...current, order: next })
  }

  useLayoutEffect(() => {
    // A card shows or hides itself once its data arrives; watch which are drawn.
    const check = () => {
      const drawn = new Set(
        [...(grid.current?.querySelectorAll(`:scope > ${CARD}`) ?? [])].map(idOf),
      )
      const missing = cards.filter((card) => !drawn.has(card.id)).map((card) => card.id)
      setBlank((current) => (current.join() === missing.join() ? current : missing))
    }
    const frame = requestAnimationFrame(check)
    const observer = new MutationObserver(check)
    if (grid.current) observer.observe(grid.current, { childList: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [cards, grid])

  useLayoutEffect(() => {
    const rects = before.current
    before.current = null
    if (!rects || reducedMotion()) return
    for (const element of elements()) {
      const from = rects.get(idOf(element) ?? '')
      if (!from) continue
      element.style.transition = ''
      element.style.transform = ''
      const to = element.getBoundingClientRect()
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (!dx && !dy) continue
      element.style.transform = `translate(${dx}px, ${dy}px)`
      // Reading the box applies the offset before the transition takes it away.
      element.getBoundingClientRect()
      element.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)'
      element.style.transform = ''
      element.addEventListener('transitionend', () => (element.style.transition = ''), {
        once: true,
      })
    }
  })

  const pointerDrag = (card: DashboardCardEntry, down: PointerEvent<HTMLButtonElement>) => {
    if (!down.isPrimary || down.button !== 0) return
    down.preventDefault()
    const section = down.currentTarget.closest<HTMLElement>(CARD)
    if (!section) return
    const start = { x: down.clientX, y: down.clientY }
    let ghost: HTMLElement | null = null
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== down.pointerId) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (!ghost) {
        // A press without a move is no drag: the grip keeps its tooltip and focus.
        if (Math.hypot(dx, dy) < 4) return
        ghost = makeGhost(section)
        document.documentElement.style.cursor = 'grabbing'
        setLift({ id: card.id, order: latest.current.layout.order, by: 'pointer' })
      }
      ghost.style.transform = `translate(${dx}px, ${dy}px)`
      const current = latest.current.lift
      const target = idOf(document.elementFromPoint(event.clientX, event.clientY))
      if (!current || !target || target === card.id) return
      const own = grid.current?.querySelector(`:scope > [data-dashboard-card="${card.id}"]`)
      const over = grid.current?.querySelector(`:scope > [data-dashboard-card="${target}"]`)
      if (!own || !over) return
      const ownRect = own.getBoundingClientRect()
      const overRect = over.getBoundingClientRect()
      const forward = current.order.indexOf(target) > current.order.indexOf(card.id)
      const sameRow = Math.abs(overRect.top - ownRect.top) < overRect.height / 2
      if (!passesMiddle(overRect, { x: event.clientX, y: event.clientY }, forward, sameRow)) return
      setLift({ ...current, order: moveDashboardCard(current.order, card.id, target) })
    }
    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape, true)
      if (!ghost) return
      ghost.remove()
      document.documentElement.style.cursor = ''
      const dropped = latest.current.lift?.order ?? latest.current.layout.order
      if (drop) {
        // The cards are already where they drop: no slide.
        latest.current.lift = null
        setLiftState(null)
        commit(dropped)
        say('dashboardCardDropped', card, dropped)
      } else {
        setLift(null)
        say('dashboardCardMoveCancelled', card, latest.current.layout.order)
      }
    }
    const up = (event: globalThis.PointerEvent) =>
      event.pointerId === down.pointerId && finish(true)
    const cancel = (event: globalThis.PointerEvent) =>
      event.pointerId === down.pointerId && finish(false)
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape, true)
  }

  const keyboardMove = (card: DashboardCardEntry, event: KeyboardEvent<HTMLButtonElement>) => {
    const lifted = lift?.by === 'keyboard' && lift.id === card.id ? lift : null
    const handle = event.currentTarget
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (lifted) {
        setLift(null)
        commit(lifted.order)
        say('dashboardCardDropped', card, lifted.order)
        // The card's grip moves in the page with the drop; keep the keyboard on it.
        requestAnimationFrame(() => handle.focus())
      } else {
        setLift({ id: card.id, order: layout.order, by: 'keyboard' })
        say('dashboardCardPickedUp', card, layout.order)
      }
      return
    }
    if (event.key === 'Escape' && lifted) {
      event.preventDefault()
      event.stopPropagation()
      setLift(null)
      say('dashboardCardMoveCancelled', card, layout.order)
      return
    }
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key]
    if (!step) return
    event.preventDefault()
    const from = lifted?.order ?? layout.order
    const shown = places(from)
    const target = shown[shown.indexOf(card.id) + step]
    if (!target) return
    const next = moveDashboardCard(from, card.id, target)
    if (lifted) {
      setLift({ ...lifted, order: next })
    } else {
      setLift(null)
      commit(next)
      requestAnimationFrame(() => handle.focus())
    }
    say('dashboardCardMoved', card, next)
  }

  return (
    // One column on a narrow page; from 56rem twelve, in rows of one height (a chart card's) packed by `packDashboardRows`.
    <div className="@container/dashboard">
      <div
        ref={grid}
        className="grid grid-cols-1 gap-4 @4xl/dashboard:auto-rows-[24.75rem] @4xl/dashboard:grid-cols-12"
      >
        {cards.map((card) => (
          <CardDragContext
            key={card.id}
            value={{
              id: card.id,
              label: card.label,
              lifted: lift?.id === card.id ? lift.by : undefined,
              // The cards stay in the page in their saved order while a move previews; `order` places them.
              order: lift ? order.indexOf(card.id) : undefined,
              handle: {
                onPointerDown: (event) => pointerDrag(card, event),
                onKeyDown: (event) => keyboardMove(card, event),
                onBlur: () => {
                  if (lift?.by !== 'keyboard' || lift.id !== card.id) return
                  setLift(null)
                  say('dashboardCardMoveCancelled', card, layout.order)
                },
              },
            }}
          >
            <card.Component className={`min-w-0 ${SPANS[spans.get(card.id) ?? 12]}`} />
          </CardDragContext>
        ))}
        <p id="dashboard-move-hint" className="sr-only">
          {translate('dashboardMoveHint')}
        </p>
        <output className="sr-only">{announcement}</output>
      </div>
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
