import { IconTile } from '@helvetly/ui/components/icon-tile'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'

import { RecordLink } from '@/components/record-link'
import { categoryOf, type Notification } from '@/lib/notifications'

/** The category's icon on a neutral tile; AI and Heidi keep Heidi's colour. */
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  return (
    <IconTile
      icon={categoryOf(category).icon}
      variant={category === 'ai' ? 'heidi' : 'neutral'}
      className={className}
    />
  )
}

/** "Anna Muster · 5 minutes ago", the exact time on hover. */
export function NotificationMeta({ n, className }: { n: Notification; className?: string }) {
  return (
    <span
      className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}
    >
      {n.actor && (
        <>
          <span className="truncate">{n.actor}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <time
        dateTime={n.created_at}
        title={new Date(n.created_at).toLocaleString()}
        className="shrink-0"
      >
        {formatRelative(n.created_at)}
      </time>
    </span>
  )
}

/** A notification's title, the same in the bubble and on the page: semibold, dimmed once read. */
export function NotificationTitle({ n, className = '' }: { n: Notification; className?: string }) {
  // Plain strings, not cn(): tailwind-merge would take text-body for a colour and drop it.
  const tone = n.read ? 'text-foreground/85' : 'text-foreground'
  return (
    <span className={`text-body leading-snug font-semibold wrap-anywhere ${tone} ${className}`}>
      {n.title}
    </span>
  )
}

/** The line under the title, in the bubble on one line, on the page on up to two. */
export function NotificationBody({ n, className = '' }: { n: Notification; className?: string }) {
  if (!n.body) return null
  return <span className={`text-body-sm text-muted-foreground ${className}`}>{n.body}</span>
}

/** A new notification's green dot, in the bubble and on the page. */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span className={cn('size-2 shrink-0 rounded-full bg-success-solid', className)}>
      <span className="sr-only">New</span>
    </span>
  )
}

/** The bubble's rows: the whole row opens what it is about; unread ones are tinted and dotted. */
export function NotificationList({
  items,
  onOpen,
  className,
}: {
  items: Notification[]
  onOpen?: (n: Notification) => void
  className?: string
}) {
  return (
    <ul className={cn('grid gap-0.5 p-1.5', className)}>
      {items.map((n) => (
        <li key={n.id} data-unread={!n.read || undefined}>
          <RecordLink
            href={n.href}
            prefetch={false}
            onClick={() => onOpen?.(n)}
            className={cn(
              'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl px-2.5 py-2.5 transition-colors outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring',
              !n.read && 'bg-success-solid/[0.06]',
            )}
          >
            <CategoryIcon category={n.category} />
            <span className="grid min-w-0 gap-0.5">
              <NotificationTitle n={n} className="line-clamp-2" />
              <NotificationBody n={n} className="truncate" />
              <NotificationMeta n={n} />
            </span>
            {n.read ? <span className="size-2" /> : <UnreadDot className="mt-1.5" />}
          </RecordLink>
        </li>
      ))}
    </ul>
  )
}
