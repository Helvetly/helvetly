import { cn } from '@helvetly/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** The colour language of every history in the app: what kind of step it was, at a glance. */
export type TimelineTone =
  | 'neutral'
  | 'brand'
  | 'info'
  | 'violet'
  | 'success'
  | 'warning'
  | 'danger'

const TONES: Record<TimelineTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  brand: 'bg-brand-surface text-brand',
  info: 'bg-info-surface text-info',
  violet: 'bg-violet-surface text-violet',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-warning',
  danger: 'bg-destructive-surface text-destructive',
}

/**
 * One step of a vertical history (a signature's audit trail, a quote's revisions): a small icon in a soft tinted
 * circle, a subtle line down to the next step, and the content beside it. Put the items in an <ol>.
 */
export function TimelineItem({
  tone,
  icon: Icon,
  dashed,
  last,
  children,
}: {
  tone: TimelineTone
  icon: LucideIcon
  /** A step not taken yet (a draft): a dashed ring instead of the tint. */
  dashed?: boolean
  last: boolean
  children: ReactNode
}) {
  return (
    <li
      data-tone={tone}
      className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0"
    >
      {!last && (
        <span aria-hidden className="absolute top-7 bottom-1 left-[11.5px] w-px bg-border" />
      )}
      <span
        aria-hidden
        className={cn(
          'flex size-6 items-center justify-center rounded-full',
          dashed ? 'border border-dashed border-muted-foreground/50 bg-card' : TONES[tone],
          dashed && 'text-muted-foreground',
        )}
      >
        <Icon className="size-3.5 stroke-[2]" />
      </span>
      <div className="grid min-w-0 gap-0.5 pt-0.5">{children}</div>
    </li>
  )
}
