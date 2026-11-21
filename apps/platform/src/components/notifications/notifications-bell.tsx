'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Sheet, SheetContent, SheetTitle } from '@helvetly/ui/components/sheet'
import { SidebarMenuButton, useSidebar } from '@helvetly/ui/components/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, Bell, BellOff, CheckCheck, Settings } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useId, useState, type ReactNode, type UIEvent } from 'react'

import { LoadError } from '@/components/load-error'
import { WithShortcut } from '@/components/shortcuts/shortcut-keys'
import { translate } from '@/lib/i18n'
import {
  bellCounts,
  bellSections,
  useLatestNotifications,
  useMarkAllRead,
  useNotificationPrefs,
  useRefreshNotifications,
  useSetRead,
  type BellFilter,
  type Notification,
} from '@/lib/notifications'

import { NotificationList } from './notification-list'
import { PrefsLink } from './prefs-drawer'

const countText = (unread: number) => (unread > 99 ? '99+' : String(unread))

/**
 * The sidebar's Notifications item, under Ask Heidi, with the unread count. It opens the notifications: a bubble
 * beside the sidebar on a computer, a sheet from the bottom on a phone. Opening them marks nothing read: opening an
 * item or "Mark all as read" does.
 */
export function NotificationsBell({ className, onGo }: { className?: string; onGo?: () => void }) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const latest = useLatestNotifications()
  const refresh = useRefreshNotifications()
  const unread = latest.data?.unread ?? 0
  const toggle = (next: boolean) => {
    setOpen(next)
    // Opening loads anew, cancelling a load still on its way with an older cutoff (from closing just before);
    // closing updates the page's lists too.
    void (next ? latest.refetch() : refresh())
  }
  const go = () => {
    toggle(false)
    onGo?.()
  }
  const countId = useId()
  const describedBy = unread > 0 ? countId : undefined
  const content = (
    <>
      {/* While anything is unread the bell rings now and then (never with reduced motion: globals.css). */}
      <Bell data-testid="bell-icon" className={unread > 0 ? 'bell-ring' : undefined} />
      <span>{translate('notifications')}</span>
      {/* The name stays the visible word; the count is the item's description. */}
      {unread > 0 && (
        <span id={countId} hidden>
          {countText(unread)}
          {translate('unread')}
        </span>
      )}
      {unread > 0 && (
        <Badge
          tone="green"
          size="sm"
          className="ml-auto min-w-5 justify-center tabular-nums group-data-[collapsible=icon]:hidden"
          aria-hidden
          data-testid="bell-count"
        >
          {countText(unread)}
        </Badge>
      )}
      {unread > 0 && (
        // On the collapsed icon rail the count does not fit: a green dot on the bell.
        <span
          aria-hidden
          data-testid="bell-dot"
          className="absolute top-1.5 right-1.5 hidden size-2 rounded-full bg-success-solid ring-2 ring-sidebar group-data-[collapsible=icon]:block"
        />
      )}
    </>
  )

  if (isMobile)
    return (
      <Sheet open={open} onOpenChange={toggle}>
        <SidebarMenuButton
          aria-describedby={describedBy}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={className}
          onClick={() => toggle(true)}
        >
          {content}
        </SidebarMenuButton>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          // The sheet's × sits in the corner: the header's button keeps clear of it.
          className="max-h-[90svh] gap-0 rounded-t-2xl p-0 [&_[data-slot=panel-head]]:pr-10"
        >
          <NotificationsPanel
            title={<SheetTitle className="sr-only">{translate('notifications')}</SheetTitle>}
            onGo={go}
            phone
          />
        </SheetContent>
      </Sheet>
    )

  return (
    <Popover open={open} onOpenChange={toggle}>
      <SidebarMenuButton
        asChild
        tooltip={{
          children: <WithShortcut label={translate('notifications')} id="notifications" />,
        }}
        aria-describedby={describedBy}
        className={cn(className, 'relative aria-expanded:bg-sidebar-accent')}
      >
        <PopoverTrigger>{content}</PopoverTrigger>
      </SidebarMenuButton>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        aria-labelledby="notifications-title"
        className="max-h-[calc(var(--radix-popover-content-available-height)-0.5rem)] w-[min(26rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-2xl p-0"
      >
        <NotificationsPanel
          title={
            <h2 id="notifications-title" className="min-w-0 truncate text-sm font-semibold">
              {translate('notifications')}
            </h2>
          }
          onGo={go}
        />
      </PopoverContent>
    </Popover>
  )
}

const FILTERS: { value: BellFilter; label: string }[] = [
  { value: 'all', label: translate('all') },
  { value: 'needs', label: translate('needsYou') },
  { value: 'updates', label: translate('updates') },
]

const EMPTY: Record<BellFilter, string> = {
  all: translate('youReAllCaughtUp'),
  needs: translate('nothingNeedsYou'),
  updates: translate('noUpdatesYet'),
}

/** Whether the list has more above or below its scrolled view, for the soft fades at its edges. */
function useScrollEdges() {
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measure = useCallback((node: HTMLElement) => {
    const top = node.scrollTop > 0
    const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 1
    setEdges((was) => (was.top === top && was.bottom === bottom ? was : { top, bottom }))
  }, [])
  const observe = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      measure(node)
      // New or settled items change the height without a scroll.
      const observer = new ResizeObserver(() => measure(node))
      if (node.firstElementChild) observer.observe(node.firstElementChild)
      observer.observe(node)
      return () => observer.disconnect()
    },
    [measure],
  )
  return { edges, observe, onScroll: (event: UIEvent<HTMLElement>) => measure(event.currentTarget) }
}

/**
 * What the bubble and the sheet hold: one compact row with the title, the filters and "Mark all as read"; the list,
 * which scrolls past about eight items while the header and footer stay; and a footer to the full page and the
 * settings.
 */
function NotificationsPanel({
  title,
  onGo,
  phone = false,
}: {
  title: ReactNode
  onGo: () => void
  /** On a phone the sheet's title is only spoken: the filters get the row, starting at its left. */
  phone?: boolean
}) {
  const [filter, setFilter] = useState<BellFilter>('all')
  const latest = useLatestNotifications({ live: true })
  const markAll = useMarkAllRead()
  const setRead = useSetRead()
  const prefs = useNotificationPrefs()
  const { edges, observe, onScroll } = useScrollEdges()
  const items = latest.data?.data ?? []
  const unread = latest.data?.unread ?? 0
  const counts = bellCounts(items)
  const sections = bellSections(items, filter)
  const emailed = prefs.data?.mail_ready && prefs.data.events.some((e) => e.email)
  const openItem = (n: Notification) => {
    if (!n.read) setRead.mutate({ id: n.id, read: true })
    onGo()
  }
  return (
    <div className="flex max-h-[inherit] min-h-0 flex-col">
      <div
        data-slot="panel-head"
        className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4"
      >
        {title}
        <fieldset className={cn('flex shrink-0 items-center gap-0.5', phone ? '-ml-2' : 'ml-auto')}>
          <legend className="sr-only">{translate('showNotifications')}</legend>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-body-sm text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-foreground/6 aria-pressed:font-medium aria-pressed:text-foreground"
            >
              {f.label}
              {/* An empty filter shows no count; the space reads "Needs you 2". */}
              {counts[f.value] > 0 && (
                <>
                  {' '}
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      f.value === 'needs' ? 'text-warning' : 'text-muted-foreground',
                    )}
                  >
                    {counts[f.value]}
                  </span>
                </>
              )}
            </button>
          ))}
        </fieldset>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn('text-muted-foreground', phone && 'ml-auto')}
              aria-label={translate('markAllAsRead2')}
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translate('markAllAsRead2')}</TooltipContent>
        </Tooltip>
      </div>
      {latest.isPending ? (
        <Loader className="min-h-52" />
      ) : latest.isError ? (
        <div className="p-3">
          <LoadError
            what="notifications"
            error={latest.error}
            onRetry={() => void latest.refetch()}
          />
        </div>
      ) : !sections.length ? (
        <div className="grid justify-items-center gap-2 px-6 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <BellOff className="size-4 stroke-[1.75]" />
          </span>
          <p className="text-body-sm text-muted-foreground">{EMPTY[filter]}</p>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-col">
          <div
            ref={observe}
            onScroll={onScroll}
            data-testid="bell-list"
            data-notification-rows
            // About eight rows, then it scrolls; the header and footer stay where they are.
            className="max-h-[min(60svh,32rem)] min-h-0 overflow-y-auto overscroll-contain"
          >
            <div className="py-1.5">
              {sections.map((s) => (
                <section key={s.key} aria-labelledby={`bell-${s.key}`}>
                  {/* Under one filter the heading would repeat the tab: only screen readers get it. */}
                  <h3
                    id={`bell-${s.key}`}
                    className={cn(
                      'px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground',
                      filter !== 'all' && 'sr-only',
                    )}
                  >
                    {s.label}
                  </h3>
                  <NotificationList items={s.items} onOpen={openItem} />
                </section>
              ))}
            </div>
          </div>
          <div
            aria-hidden
            data-on={edges.top || undefined}
            className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-linear-to-b from-popover to-transparent opacity-0 transition-opacity duration-150 data-on:opacity-100"
          />
          <div
            aria-hidden
            data-on={edges.bottom || undefined}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-popover to-transparent opacity-0 transition-opacity duration-150 data-on:opacity-100"
          />
        </div>
      )}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-t px-2">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/notifications" onClick={onGo}>
            {translate('viewAllNotifications')}
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={translate('notificationSettings2')}
            >
              <PrefsLink onClick={onGo}>
                <Settings />
              </PrefsLink>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {translate('notificationSettings2')}
            {emailed && <span className="block opacity-70">{translate('alsoSentByEmail')}</span>}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
