import { cn } from '@helvetly/ui/lib/utils'
import type { ReactNode } from 'react'

/** The tints by tone, also for icon tiles that should match a badge. */
export const TONES = {
  green: 'bg-success-surface text-success',
  blue: 'bg-info-surface text-info',
  amber: 'bg-warning-surface text-warning',
  red: 'bg-destructive-surface text-destructive',
  gray: 'bg-muted text-muted-foreground ring-1 ring-foreground/[0.06] ring-inset',
}

export type Tone = keyof typeof TONES

/** A small tinted label with tinted text: "Paid", "Sent", "Overdue". */
export function StatusBadge({
  tone = 'gray',
  size = 'md',
  children,
}: {
  tone?: Tone
  /** sm: beside a name in a list row, where the full size outweighs the text it marks. */
  size?: 'sm' | 'md'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-caption font-medium' : 'h-6 px-1.5 text-[13px]',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}
