'use client'

import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowUpRight, Bell, CheckCheck, Mail, MailOpen, Settings2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { State } from '@/components/data/table-page'
import { LoadError } from '@/components/load-error'
import { PrefsLink } from '@/components/notifications/prefs-drawer'
import { parseRecordHref, RecordLink } from '@/components/record-link'
import { PAGE_WIDTH, PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import {
  byDay,
  useLatestNotifications,
  useMarkAllRead,
  useNotificationPages,
  useSetRead,
  type Notification,
} from '@/lib/notifications'

import {
  CategoryIcon,
  NotificationBody,
  NotificationMeta,
  NotificationTitle,
  UnreadDot,
} from './notification-list'

/** Every notification of the person in this workspace, newest first and by day, filtered and a page at a time. */
export function NotificationsPage() {
  const pages = useNotificationPages({ unread: false, category: null })
  // The bell's count is the person's total, whatever this page filters.
  const bell = useLatestNotifications()
  const markAll = useMarkAllRead()
  const items = pages.data?.pages.flatMap((page) => page.data) ?? []
  const unread = pages.data?.pages[0]?.unread ?? bell.data?.unread ?? 0

  return (
    <>
      <PageHeader
        tabs={['Notifications']}
        tabIcons={[Bell]}
        savedViews={false}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              title="Mark all as read"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate(undefined, { onError: toastError })}
            >
              <CheckCheck />
              <span className="max-sm:sr-only">Mark all as read</span>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <PrefsLink title="Notification preferences">
                <Settings2 />
                <span className="max-md:sr-only">Preferences</span>
              </PrefsLink>
            </Button>
          </>
        }
      />
      <div className="flex-1">
        <div
          className={cn(
            // Left-aligned like the other list pages, kept to a readable width.
            'grid w-full content-start gap-6 px-4 py-6 @3xl:px-8 @3xl:py-8',
            PAGE_WIDTH.normal,
          )}
        >
          <div className="flex items-end justify-between gap-3">
            <div className="grid gap-1">
              <h1 className="text-lg font-medium tracking-tight">Notifications</h1>
              <p className="text-sm text-pretty text-muted-foreground">
                {unread > 0
                  ? `${unread} unread · what happened in this workspace that concerns you.`
                  : 'What happened in this workspace that concerns you.'}
              </p>
            </div>
          </div>
          <div className="grid min-w-0 content-start gap-6">
            {pages.isPending ? (
              <Loader label="Loading notifications" className="min-h-96" />
            ) : pages.isError && !pages.data ? (
              <LoadError
                what="notifications"
                error={pages.error}
                onRetry={() => void pages.refetch()}
              />
            ) : items.length === 0 ? (
              <Empty />
            ) : (
              byDay(items).map((day) => (
                <section key={day.label} aria-label={day.label} className="grid gap-2">
                  <h2 className="px-1 text-body-sm font-medium text-muted-foreground">
                    {day.label}
                  </h2>
                  <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                    {day.items.map((n) => (
                      <Row key={n.id} n={n} />
                    ))}
                  </ul>
                </section>
              ))
            )}
            {pages.hasNextPage && (
              <MorePages
                loading={pages.isFetchingNextPage}
                error={pages.isFetchNextPageError ? errorMessage(pages.error) : null}
                onMore={() => {
                  if (!pages.isFetchingNextPage) void pages.fetchNextPage()
                }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ n }: { n: Notification }) {
  const setRead = useSetRead()
  const toggle = () => setRead.mutate({ id: n.id, read: !n.read }, { onError: toastError })
  const label = n.read ? 'Mark as unread' : 'Mark as read'
  return (
    <li
      data-unread={!n.read || undefined}
      className={cn(
        'group/row relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 py-3.5 pr-3 pl-6 transition-colors hover:bg-foreground/[0.02] sm:pr-4',
        !n.read && 'bg-success-solid/[0.05]',
      )}
    >
      {!n.read && <UnreadDot className="absolute top-[26px] left-2.5" />}
      <CategoryIcon category={n.category} className="mt-0.5 size-9 rounded-xl" />
      <div className="grid min-w-0 gap-1">
        <RecordLink
          href={n.href}
          prefetch={false}
          onClick={() => !n.read && setRead.mutate({ id: n.id, read: true })}
          className="underline-offset-2 hover:underline focus-visible:underline"
        >
          <NotificationTitle n={n} />
        </RecordLink>
        <NotificationBody n={n} className="line-clamp-2 text-pretty wrap-anywhere" />
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <NotificationMeta n={n} />
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          disabled={setRead.isPending}
          onClick={toggle}
          className="text-muted-foreground hover:text-foreground"
        >
          {n.read ? <Mail /> : <MailOpen />}
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground max-sm:hidden"
        >
          <RecordLink
            href={n.href}
            prefetch={false}
            onClick={() => !n.read && setRead.mutate({ id: n.id, read: true })}
          >
            {/* A record opens in place; anything else is another page. */}
            Open {!parseRecordHref(n.href) && <ArrowUpRight />}
          </RecordLink>
        </Button>
      </div>
    </li>
  )
}

function Empty() {
  return (
    <State
      icon={<Bell />}
      title="No notifications yet"
      text="Payments, overdue invoices, signatures, client portal activity, imports and team changes show up here."
      action={null}
    />
  )
}

/** Loads the next page when its end scrolls into view; the button is the fallback (and for keyboards). */
function MorePages({
  loading,
  error,
  onMore,
}: {
  loading: boolean
  error: string | null
  onMore: () => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const latest = useRef(onMore)
  useEffect(() => {
    latest.current = onMore
  })
  useEffect(() => {
    const element = sentinel.current
    if (!element || error || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [error])
  return (
    <div ref={sentinel} className="grid justify-center gap-2 text-center">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button variant="outline" disabled={loading} onClick={onMore}>
        {loading ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  )
}
