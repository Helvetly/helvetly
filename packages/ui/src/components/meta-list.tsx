import { cn } from '@helvetly/ui/lib/utils'
import type * as React from 'react'

/**
 * A row's secondary facts as separate items (an icon and a value each) instead of one " · "-joined line:
 * they wrap only between items, never inside one.
 */
export function MetaList({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="meta-list"
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-body-sm text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** One fact of a `MetaList`. `icon` is a lucide icon; `tone="success"` colours a live status. */
export function MetaItem({
  icon,
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & { icon?: React.ReactNode; tone?: 'success' }) {
  return (
    <span
      data-slot="meta-item"
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap',
        '[&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground/70',
        tone === 'success' && 'text-success [&>svg]:text-current',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}

/** A small filled dot before a status, in its colour ("● Active now"). */
export function MetaDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="meta-dot"
      className={cn('size-2 shrink-0 rounded-full bg-success-solid', className)}
    />
  )
}
