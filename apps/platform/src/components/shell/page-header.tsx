'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@helvetly/ui/components/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { SidebarTrigger } from '@helvetly/ui/components/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { ariaKeyShortcuts } from '@helvetly/ui/lib/shortcuts'
import { cn } from '@helvetly/ui/lib/utils'
import { ChevronDown, Ellipsis, Plus, X } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'

import { WithShortcut } from '@/components/shortcuts/shortcut-keys'
import { translate } from '@/lib/i18n'
import { useCanWriteHere } from '@/lib/permissions'
import { SHORTCUTS, useApple, useShortcut } from '@/lib/shortcuts'

import { usePublishPrimary } from './primary-action'

const soon = (what: string) => () => toast(translate('comingSoon', { what: what }))

/** The gap between tabs in the row (Tailwind `gap-1`). */
const GAP = 4

/**
 * Which tabs fit in `room` pixels, in their order. When not all fit, room is kept for the "More"
 * button, the active tab always stays (its neighbours from the start fill what is left) and the
 * rest go into "More". `extra` is the width of what follows the tabs when they all fit ("+").
 */
export function fitTabs({
  widths,
  room,
  more,
  extra = 0,
  active,
}: {
  widths: number[]
  room: number
  more: number
  extra?: number
  active: number
}): number[] {
  const all = widths.map((_, index) => index)
  const total = widths.reduce((sum, width) => sum + width, 0) + GAP * (widths.length - 1)
  if (total + (extra && GAP + extra) <= room) return all
  const keep = widths[active] === undefined ? 0 : active
  const budget = room - GAP - more
  const shown = new Set([keep])
  let used = widths[keep] ?? 0
  for (const index of all) {
    if (index === keep) continue
    const width = widths[index] ?? 0
    if (used + GAP + width > budget) break
    shown.add(index)
    used += GAP + width
  }
  return all.filter((index) => shown.has(index))
}

/**
 * Measures the tabs in an invisible copy of the row and keeps the ones that fit the row's width
 * visible, again on every resize (the window, the sidebar, Heidi's panel opening).
 */
function useVisibleTabs(count: number, active: number, extra: boolean) {
  const row = useRef<HTMLElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<number[] | null>(null)
  useLayoutEffect(() => {
    const element = row.current
    const copy = ruler.current
    if (!element || !copy) return
    const measure = () => {
      // Not laid out (hidden, or a test without layout): keep what is shown.
      if (element.clientWidth === 0) return
      const parts = [...copy.querySelectorAll<HTMLElement>(':scope > *')].map(
        (part) => part.offsetWidth,
      )
      const widths = parts.slice(0, count)
      const style = getComputedStyle(element)
      const room =
        element.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0)
      const next = fitTabs({
        widths,
        room,
        more: parts[count] ?? 0,
        extra: extra ? (parts[count + 1] ?? 0) : 0,
        active,
      })
      setVisible((current) =>
        current?.length === next.length && current.every((value, i) => value === next[i])
          ? current
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(copy)
    return () => observer.disconnect()
  }, [count, active, extra])
  return { row, ruler, visible: visible ?? [...Array(count).keys()] }
}

/**
 * The panel's top bar: saved views as tabs (with "+"), then the page's primary action,
 * and a "…" menu. A page with one view passes a single tab: no tab row and no visible title.
 */
export function PageHeader({
  tabs,
  active = 0,
  onSelect,
  primary,
  onPrimary,
  primaryMenu,
  menu,
  actions,
  savedViews = true,
  tabMenu,
  tabIcons,
  tabCounts,
  onCloseTab,
  keepTab = false,
}: {
  tabs: string[]
  active?: number
  onSelect?: (index: number) => void
  /** The solid button, e.g. "New invoice"; its click says the flow is coming. */
  primary?: string
  /** What the primary button does; without it the button says the flow is coming. */
  onPrimary?: () => void
  /** Items for a chevron joined to the primary button (a split button), e.g. other kinds to create. */
  primaryMenu?: ReactNode
  /** The page's own "…" menu items; without them there is no "…" button. */
  menu?: ReactNode
  /** The page's own controls, before the primary button. */
  actions?: ReactNode
  /** The "+" that saves a view; off where the tabs are pages, not views (settings). */
  savedViews?: boolean
  /** A tab's right-click menu items (e.g. Close tab); none for tabs that return nothing. */
  tabMenu?: (index: number) => ReactNode
  /** An icon per tab; every page passes them, so tabs read the same across the app. */
  tabIcons?: ComponentType<{ className?: string }>[]
  /** How many records a tab holds, for tabs that ask for action; zero or none shows nothing. */
  tabCounts?: (number | undefined)[]
  /** Tabs the person added get an "×"; returns the close action for those, nothing for fixed tabs. */
  onCloseTab?: (index: number) => (() => void) | undefined
  /** Show a single tab as a tab, for a fixed view that pinned views join (Documents' "All files"). */
  keepTab?: boolean
}) {
  // One tab is no choice: the bar shows it as the page's title.
  const title = tabs.length === 1 && !keepTab ? tabs[0] : undefined
  const showTabs = title === undefined
  const canSave = showTabs && Boolean(onSelect) && savedViews
  const { row, ruler, visible } = useVisibleTabs(showTabs ? tabs.length : 0, active, canSave)
  const hidden = showTabs ? tabs.map((_, index) => index).filter((i) => !visible.includes(i)) : []
  const hiddenCount = hidden.reduce((sum, index) => sum + (tabCounts?.[index] ?? 0), 0)
  // A person who cannot change this page's records gets no "New …" button.
  const writable = useCanWriteHere()
  const apple = useApple()
  const runPrimary = onPrimary ?? soon(`${primary} is`)
  usePublishPrimary(primary && writable ? primary : undefined, runPrimary)
  const saveView = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={translate('saveAView')}
      className="shrink-0 self-center text-muted-foreground"
      onClick={soon(translate('savedViewsAre'))}
    >
      <Plus className="stroke-[1.5]" />
    </Button>
  )
  const moreLabel = (
    <>
      {translate('more')}
      <span className="sr-only">{translate('views2')}</span>
      {hiddenCount > 0 && <TabCount count={hiddenCount} />}
      <ChevronDown className="ml-1.5 size-4 shrink-0 stroke-[1.5] opacity-80" />
    </>
  )
  return (
    // --tab is the page card's colour, so the active tab matches the card below.
    <header
      // From md the panel sits 8px below the window's top (the inset's margin), so the bar reads as 60px:
      // pb-2 centres the controls, tabs included, in it.
      // The after element keeps the panel's top corners rounded while the content scrolls under the
      // header: a corner-shaped mask in the canvas colour (the shadow paints only outside the radius).
      className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-2 bg-background px-3 [--tab:var(--card)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:hidden after:h-[14px] after:rounded-t-[14px] after:shadow-[0_0_0_14px_var(--background)] after:[clip-path:inset(0)] md:px-5 md:pb-2 md:after:block"
    >
      {/* Collapses the sidebar to an icon rail (also ⌘B / Ctrl+B). Hidden where it can't act: phones
          use Menu in the bottom bar, and tablets (the layout's RAIL range, 768–1023px) are always a rail. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger
            data-header-fixed
            aria-label={translate('toggleSidebar')}
            aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.sidebar.keys, apple)}
            className="-ml-1 shrink-0 text-muted-foreground hover:text-foreground max-lg:hidden [&_svg]:size-[18px]! [&_svg]:stroke-[1.5]"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <WithShortcut label={translate('toggleSidebar')} id="sidebar" />
        </TooltipContent>
      </Tooltip>
      {/* One tab is no choice and needs no label: the sidebar already says where you are. The name
          stays for screen readers. */}
      {title !== undefined && <h1 className="sr-only">{title}</h1>}
      {/* An invisible copy of every tab, "More" and "+", measured to know what fits. */}
      {showTabs && (
        <div
          ref={ruler}
          aria-hidden
          inert
          className="pointer-events-none invisible absolute top-0 left-0 flex h-0 overflow-hidden"
        >
          {tabs.map((tab, index) => (
            <span key={tab} className={`${TAB} shrink-0`}>
              <TabLabel
                tab={tab}
                Icon={tabIcons?.[index]}
                count={tabCounts?.[index]}
                closable={Boolean(onCloseTab?.(index))}
              />
            </span>
          ))}
          <span className={`${TAB} shrink-0`}>
            {translate('more')}
            <TabCount count={tabCounts?.reduce<number>((sum, n) => sum + (n ?? 0), 0) ?? 0} />
            <ChevronDown className="ml-1.5 size-4" />
          </span>
          <span className="size-7 shrink-0" />
        </div>
      )}
      {/* The tabs that fit, the active one always among them; the rest are under "More". The row
          never scrolls, so no tab is ever out of sight without a way back to it. */}
      <nav
        ref={row}
        aria-label={translate('views')}
        hidden={!showTabs}
        className="flex h-full min-w-0 flex-1 items-center gap-1 px-2.5"
      >
        {showTabs &&
          visible.map((index) => {
            const tab = tabs[index] ?? ''
            const close = onCloseTab?.(index)
            const button = (
              <button
                key={tab}
                type="button"
                aria-current={index === active ? 'page' : undefined}
                onClick={() => onSelect?.(index)}
                onKeyDown={(event) => {
                  if (close && (event.key === 'Delete' || event.key === 'Backspace')) close()
                }}
                // Only the active tab can be too wide alone (a phone): it shortens with an ellipsis.
                className={`${TAB} ${index === active ? 'min-w-0' : 'shrink-0'}`}
              >
                <TabLabel
                  tab={tab}
                  Icon={tabIcons?.[index]}
                  count={tabCounts?.[index]}
                  onClose={close}
                />
              </button>
            )
            const tabItems = tabMenu?.(index)
            return tabItems ? (
              <ContextMenu key={tab}>
                <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
                <ContextMenuContent className="min-w-48">{tabItems}</ContextMenuContent>
              </ContextMenu>
            ) : (
              button
            )
          })}
        {hidden.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`${TAB} shrink-0 data-[state=open]:bg-foreground/[0.05]`}
              >
                {moreLabel}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
              {hidden.map((index) => {
                const Icon = tabIcons?.[index]
                const count = tabCounts?.[index]
                return (
                  <DropdownMenuItem key={tabs[index]} onSelect={() => onSelect?.(index)}>
                    {Icon && <Icon className="stroke-[1.5]" />}
                    <span className="flex-1">{tabs[index]}</span>
                    {Boolean(count) && <TabCount count={count ?? 0} />}
                  </DropdownMenuItem>
                )
              })}
              {canSave && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={soon(translate('savedViewsAre'))}>
                    <Plus className="stroke-[1.5]" />
                    {translate('saveAView')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canSave && hidden.length === 0 && saveView}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={translate('more')}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {actions}
        {primary && writable && (
          // On phones the bottom bar's "+" is this button.
          <span className="contents max-md:hidden">
            <PrimaryButton label={primary} onClick={runPrimary} menu={primaryMenu} />
          </span>
        )}
      </div>
    </header>
  )
}

// A plain string, not cn(): tailwind-merge would take text-title-sm for a colour and drop it.
const TAB = [
  // Every tab is one height, centred in the bar like its buttons; the active one is a card-coloured pill.
  'group/tab relative flex h-9 items-center rounded-xl px-3.5 text-title-sm whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'aria-[current=page]:bg-(--tab) aria-[current=page]:text-foreground aria-[current=page]:ring-1 aria-[current=page]:ring-border/70 aria-[current=page]:hover:bg-(--tab)',
].join(' ')

function TabCount({ count }: { count: number }) {
  return (
    <span className="ml-2 rounded-full bg-foreground/[0.06] px-1.5 text-xs leading-5 text-muted-foreground tabular-nums">
      {count}
    </span>
  )
}

/** A tab's icon, name, count and, for a tab the person added, its "×". */
function TabLabel({
  tab,
  Icon,
  count,
  onClose,
  closable = Boolean(onClose),
}: {
  tab: string
  Icon?: ComponentType<{ className?: string }>
  count?: number
  onClose?: () => void
  closable?: boolean
}) {
  return (
    <>
      {Icon && <Icon className="mr-2 size-4 shrink-0 stroke-[1.5] opacity-80" />}
      <span className="min-w-0 truncate">{tab}</span>
      {Boolean(count) && <TabCount count={count ?? 0} />}
      {closable && (
        // Not a nested button (invalid inside a button): the tab's Delete key and its
        // right-click "Close tab" are the accessible ways to close it.
        <span
          aria-hidden
          title={translate('closeTab2')}
          onClick={(event) => {
            event.stopPropagation()
            onClose?.()
          }}
          className="-mr-1.5 ml-1.5 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity group-hover/tab:opacity-100 group-aria-[current=page]/tab:opacity-100 hover:bg-foreground/[0.08] hover:text-foreground"
        >
          <X className="size-3.5" />
        </span>
      )}
    </>
  )
}

/** The page's "New …" button, also pressed by N anywhere on the page outside text fields and dialogs. */
function PrimaryButton({
  label,
  onClick,
  menu,
}: {
  label: string
  onClick: () => void
  menu?: ReactNode
}) {
  useShortcut('newRecord', onClick)
  const button = (
    <Button
      aria-keyshortcuts="N"
      className={cn('cursor-pointer', menu && 'rounded-r-none')}
      onClick={onClick}
    >
      <Plus className="stroke-[1.75]" /> {label}
    </Button>
  )
  if (!menu) return button
  return (
    <span className="flex">
      {button}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={translate('options', { label: label })}
            className="cursor-pointer rounded-l-none border-l border-primary-foreground/20 px-1.5"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

/** How wide a content page grows: a little more on each large breakpoint, so a 2000px+ screen is not mostly empty. */
export const PAGE_WIDTH = {
  normal: 'max-w-3xl xl:max-w-4xl 2xl:max-w-5xl',
} as const
