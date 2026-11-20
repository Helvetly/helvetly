import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowUpRight, Check, Info, TriangleAlert } from 'lucide-react'

import { RecordLink } from '@/components/record-link'
import { translate } from '@/lib/i18n'
import { categoryOf, shortTime, type Notification } from '@/lib/notifications'

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
        title={new Date(n.created_at).toLocaleString(languageTag)}
        className="shrink-0"
      >
        {formatRelative(n.created_at)}
      </time>
    </span>
  )
}

/**
 * A notification's title, the same in the bubble and on the page: semibold, dimmed once read. In the bubble it is
 * one slightly smaller line; one that does not fit ends in "…" and shows whole on hover.
 */
export function NotificationTitle({ n, compact = false }: { n: Notification; compact?: boolean }) {
  // Plain strings, not cn(): tailwind-merge would take text-body for a colour and drop it.
  const tone = n.read ? 'text-foreground/85' : 'text-foreground'
  const fit = compact ? 'truncate text-body-sm' : 'text-body wrap-anywhere'
  return (
    <span
      title={compact ? n.title : undefined}
      className={`${fit} leading-snug font-semibold ${tone}`}
    >
      {n.title}
    </span>
  )
}

/** The line under the title, in the bubble on one line, on the page on up to two. */
export function NotificationBody({ n, className = '' }: { n: Notification; className?: string }) {
  if (!n.body) return null
  return <span className={`text-body-sm text-muted-foreground ${className}`}>{n.body}</span>
}

/** A new notification's blue dot, in the bubble and on the page. */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span className={cn('size-2 shrink-0 rounded-full bg-info-solid', className)}>
      <span className="sr-only">{translate('new3')}</span>
    </span>
  )
}

/** The bubble's round status mark: amber while it needs you, green once settled, blue for an update. */
function StatusMark({ n }: { n: Notification }) {
  const [Icon, tone, label] = n.resolved
    ? [Check, 'bg-success-surface text-success', translate('settled')]
    : n.needs_you
      ? [TriangleAlert, 'bg-warning-surface text-warning', translate('needsYou')]
      : [Info, 'bg-info-surface text-info', translate('update')]
  return (
    <span
      className={cn(
        'flex size-7 items-center justify-center rounded-full transition-colors duration-300',
        tone,
      )}
    >
      <Icon aria-hidden className="size-3.5 stroke-[1.75]" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * The bubble's rows: a blue dot while unread, the status mark, the title over a muted line, the time and a quiet
 * button that opens what it is about in place. One that something settled shows that instead, fading over.
 */
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
    <ul className={cn('grid', className)}>
      {items.map((n) => {
        const shown = n.resolved ?? n
        return (
          <li
            key={n.id}
            data-unread={!n.read || undefined}
            data-resolved={n.resolved ? true : undefined}
            className="grid grid-cols-[0.375rem_auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5"
          >
            {n.read ? <span /> : <UnreadDot className="mt-3 size-1.5" />}
            <StatusMark n={n} />
            {/* Keyed by the state, so a settled item's words fade in instead of jumping. */}
            <span
              key={n.resolved ? 'resolved' : 'open'}
              className={cn(
                'grid min-w-0 gap-0.5',
                n.resolved && 'slide-in-from-bottom-0.5 animate-in duration-300 fade-in',
              )}
            >
              <span
                id={`notification-${n.id}`}
                className="text-body-sm leading-snug font-medium text-pretty text-foreground"
              >
                {shown.title}
              </span>
              {(shown.body ?? n.actor) && (
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={shown.body ?? undefined}
                >
                  {shown.body ?? n.actor}
                </span>
              )}
              <Button asChild variant="outline" size="xs" className="mt-1.5 w-fit">
                <RecordLink
                  href={n.href}
                  prefetch={false}
                  aria-describedby={`notification-${n.id}`}
                  onClick={() => onOpen?.(n)}
                >
                  <ArrowUpRight data-icon="inline-start" />
                  {shown.action}
                </RecordLink>
              </Button>
            </span>
            <time
              dateTime={shown.created_at}
              title={new Date(shown.created_at).toLocaleString(languageTag)}
              className="pt-0.5 font-mono text-xs text-muted-foreground tabular-nums"
            >
              {shortTime(shown.created_at)}
            </time>
          </li>
        )
      })}
    </ul>
  )
}
