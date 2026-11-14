'use client'

import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { SidebarMenuButton, useSidebar } from '@helvetly/ui/components/sidebar'
import { cn } from '@helvetly/ui/lib/utils'
import { Bell, CheckCheck, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'

import { LoadError } from '@/components/load-error'
import { WithShortcut } from '@/components/shortcuts/shortcut-keys'
import {
  useLatestNotifications,
  useMarkAllRead,
  useRefreshNotifications,
  useSetRead,
  type Notification,
} from '@/lib/notifications'

import { NotificationList } from './notification-list'
import { PrefsLink } from './prefs-drawer'

const countText = (unread: number) => (unread > 99 ? '99+' : String(unread))

/**
 * The sidebar's Notifications item, under Ask Heidi, with the unread count. On a computer it opens a bubble with
 * the unread notifications and those read in the last minutes; opening it marks them read, while it keeps showing
 * their dots until it closes. On a phone (the sidebar is a sheet) it goes to the full page.
 */
export function NotificationsBell({ className, onGo }: { className?: string; onGo?: () => void }) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  // What was shown when the bubble opened, so marking everything read does not wipe the dots in front of the person.
  const [snapshot, setSnapshot] = useState<Notification[] | null>(null)
  const latest = useLatestNotifications()
  const markAll = useMarkAllRead()
  const setRead = useSetRead()
  const refresh = useRefreshNotifications()
  const unread = latest.data?.unread ?? 0
  const toggle = (next: boolean) => {
    setOpen(next)
    if (next && unread > 0 && latest.data) {
      setSnapshot(latest.data.data)
      markAll.mutate()
    } else if (next) {
      // Nothing new: load again, so items read more than 5 minutes ago leave the bubble.
      void latest.refetch()
    }
    if (!next) {
      setSnapshot(null)
      void refresh()
    }
  }
  const go = () => {
    toggle(false)
    onGo?.()
  }
  const openItem = (n: Notification) => {
    if (!n.read) setRead.mutate({ id: n.id, read: true })
    go()
  }
  const items = snapshot ?? latest.data?.data
  const countId = useId()
  const describedBy = unread > 0 ? countId : undefined
  const content = (
    <>
      <Bell />
      <span>Notifications</span>
      {/* The name stays the visible word; the count is the item's description. */}
      {unread > 0 && (
        <span id={countId} hidden>
          {countText(unread)} unread
        </span>
      )}
      {unread > 0 && (
        <span
          aria-hidden
          data-testid="bell-count"
          className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-success-surface px-1.5 text-[11px] leading-none font-semibold text-success tabular-nums group-data-[collapsible=icon]:hidden"
        >
          {countText(unread)}
        </span>
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
      <SidebarMenuButton asChild className={className}>
        <Link href="/notifications" aria-describedby={describedBy} onClick={onGo}>
          {content}
        </Link>
      </SidebarMenuButton>
    )

  return (
    <Popover open={open} onOpenChange={toggle}>
      <SidebarMenuButton
        asChild
        tooltip={{ children: <WithShortcut label="Notifications" id="notifications" /> }}
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
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id="notifications-title" className="text-[15px] font-medium">
            Notifications
          </h2>
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <PrefsLink
              onClick={go}
              aria-label="Notification preferences"
              title="Notification preferences"
            >
              <Settings2 />
            </PrefsLink>
          </Button>
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
        ) : !items?.length ? (
          <div className="grid justify-items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CheckCheck className="size-5 stroke-[1.5]" />
            </span>
            <p className="text-sm font-medium">You’re all caught up</p>
            <p className="text-[13px] text-pretty text-muted-foreground">
              Payments, signatures, client activity and team changes show up here.
            </p>
          </div>
        ) : (
          <NotificationList
            items={items}
            onOpen={openItem}
            className="max-h-[min(60svh,30rem)] overflow-y-auto"
          />
        )}
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck /> Mark all as read
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/notifications" onClick={go}>
              All notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
