'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Sheet, SheetContent, SheetTitle } from '@helvetly/ui/components/sheet'
import { SidebarMenuButton, useSidebar } from '@helvetly/ui/components/sidebar'
import { cn } from '@helvetly/ui/lib/utils'
import { Bell, CheckCheck, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useId, useState, type ReactNode } from 'react'

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
      <Bell />
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
            title={
              <SheetTitle className="text-title-sm font-semibold">
                {translate('notifications')}
              </SheetTitle>
            }
            onGo={go}
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
        className="w-[min(26rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-2xl p-0"
      >
        <NotificationsPanel
          title={
            <h2 id="notifications-title" className="text-title-sm font-semibold">
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

/** What the bubble and the sheet hold: the title, the filters, the list and the footer. */
function NotificationsPanel({ title, onGo }: { title: ReactNode; onGo: () => void }) {
  const [filter, setFilter] = useState<BellFilter>('all')
  const latest = useLatestNotifications({ live: true })
  const markAll = useMarkAllRead()
  const setRead = useSetRead()
  const prefs = useNotificationPrefs()
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
    <>
      <div className="grid gap-3 border-b px-4 pt-4 pb-3">
        <div data-slot="panel-head" className="flex items-center justify-between gap-2">
          {title}
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 text-muted-foreground hover:text-foreground"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {translate('markAllAsRead2')}
          </Button>
        </div>
        <fieldset className="flex w-fit gap-0.5 rounded-full bg-muted p-0.5">
          <legend className="sr-only">{translate('showNotifications')}</legend>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="flex h-7 items-center gap-1.5 rounded-full px-3 text-body-sm text-muted-foreground transition-colors duration-200 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-foreground aria-pressed:text-background"
            >
              {f.value === 'needs' && counts.needs > 0 && (
                <span aria-hidden className="size-1.5 rounded-full bg-warning-solid" />
              )}
              {/* The space reads "Needs you 2"; flex drops it from the layout. */}
              {f.label} <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </fieldset>
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
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CheckCheck className="size-5 stroke-[1.5]" />
          </span>
          <p className="text-sm font-medium">
            {filter === 'needs'
              ? translate('nothingNeedsYou')
              : filter === 'updates'
                ? translate('noUpdatesYet')
                : translate('youReAllCaughtUp')}
          </p>
          {filter === 'all' && (
            <p className="text-body-sm text-pretty text-muted-foreground">
              {translate('paymentsSignaturesClientActivityAndTeamChangesShowUp')}
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[min(60svh,30rem)] overflow-y-auto py-1">
          {sections.map((s) => (
            <section key={s.key} aria-labelledby={`bell-${s.key}`}>
              <h3 id={`bell-${s.key}`} className="px-4 pt-2.5 text-xs text-muted-foreground">
                {s.label}
              </h3>
              <NotificationList items={s.items} onOpen={openItem} />
            </section>
          ))}
        </div>
      )}
      <div className="px-4 pt-1 pb-2.5">
        <Link
          href="/notifications"
          onClick={onGo}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {translate('allNotifications')}
        </Link>
      </div>
      <div className="flex items-center justify-between gap-2 border-t bg-muted/60 px-2 py-1.5">
        <Button asChild variant="ghost" size="sm">
          <PrefsLink onClick={onGo}>
            <SlidersHorizontal />
            {translate('notificationSettings2')}
          </PrefsLink>
        </Button>
        {emailed && (
          <span className="px-2 text-xs text-muted-foreground">{translate('alsoSentByEmail')}</span>
        )}
      </div>
    </>
  )
}
