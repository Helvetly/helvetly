import { languageTag } from '@helvetly/i18n'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, Check } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import { RecordLink } from '@/components/record-link'
import { translate } from '@/lib/i18n'
import { categoryOf, rowStep, shortTime, type Notification } from '@/lib/notifications'

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

/** Up, down, Home and End move between the rows of the list around; Enter opens the focused one (it is a link). */
function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  const list = event.currentTarget.closest('[data-notification-rows]') ?? document
  const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-notification-row]'))
  const next = rowStep(event.key, rows.indexOf(event.currentTarget), rows.length)
  if (next === null) return
  event.preventDefault()
  rows[next]?.focus()
}

/** The bubble's tinted mark: the category's icon, amber while it needs you, green once settled, blue for an update. */
function StatusMark({ n }: { n: Notification }) {
  const Icon = n.resolved ? Check : categoryOf(n.category).icon
  const [tone, label] = n.resolved
    ? ['bg-success-surface text-success', translate('settled')]
    : n.needs_you
      ? ['bg-warning-surface text-warning', translate('needsYou')]
      : ['bg-info-surface text-info', translate('update')]
  return (
    <span
      className={cn(
        'flex size-6 items-center justify-center rounded-full transition-colors duration-300',
        tone,
      )}
    >
      <Icon aria-hidden className="size-3.5 stroke-[1.75]" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * The bubble's rows, each one link (the title's, covering the row) to what it is about, opened in place: a blue dot while unread, the tinted mark,
 * the title over a muted line (two lines each at most), the time, and on hover or focus an arrow. One that something
 * settled shows that instead, fading over. Up and down arrows move between the rows.
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
    <ul className={cn('grid gap-px px-1.5', className)}>
      {items.map((n) => {
        const shown = n.resolved ?? n
        return (
          <li
            key={n.id}
            data-unread={!n.read || undefined}
            data-resolved={n.resolved ? true : undefined}
            // The title's link covers the row; its ring is inset (a shadow), so focus never moves or resizes it.
            className="group/row relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg py-2 pr-2 pl-3.5 hover:bg-accent/60 has-focus-visible:bg-accent/60 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-focus-visible:ring-inset"
          >
            {!n.read && <UnreadDot className="absolute top-[1.0625rem] left-1 size-1.5" />}
            <StatusMark n={n} />
            {/* Keyed by the state, so a settled item's words fade in instead of jumping. */}
            <span
              key={n.resolved ? 'resolved' : 'open'}
              className={cn(
                'grid min-w-0 gap-0.5',
                n.resolved && 'slide-in-from-bottom-0.5 animate-in duration-300 fade-in',
              )}
            >
              <RecordLink
                href={n.href}
                prefetch={false}
                data-notification-row
                onKeyDown={moveBetweenRows}
                aria-describedby={`notification-${n.id}-more`}
                onClick={() => onOpen?.(n)}
                className={cn(
                  'line-clamp-2 text-body-sm leading-snug text-pretty outline-none after:absolute after:inset-0 after:rounded-lg',
                  n.read ? 'font-medium text-foreground/80' : 'font-semibold text-foreground',
                )}
              >
                {shown.title}
              </RecordLink>
              <span id={`notification-${n.id}-more`} className="contents">
                {(shown.body ?? n.actor) && (
                  <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {shown.body ?? n.actor}
                  </span>
                )}
                <span className="sr-only">{shown.action}</span>
              </span>
            </span>
            <span className="grid justify-items-end gap-1 pt-0.5">
              <time
                dateTime={shown.created_at}
                title={new Date(shown.created_at).toLocaleString(languageTag)}
                className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
              >
                {shortTime(shown.created_at)}
              </time>
              <ArrowRight
                aria-hidden
                className="size-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100"
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
