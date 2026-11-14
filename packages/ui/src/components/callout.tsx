import { cn } from '@helvetly/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

const TONES = {
  info: { box: 'bg-info-surface ring-info/20', accent: 'text-info' },
  warning: { box: 'bg-warning-surface ring-warning-border', accent: 'text-warning' },
  danger: { box: 'bg-destructive-surface ring-destructive/20', accent: 'text-destructive' },
  success: { box: 'bg-success-surface ring-success/20', accent: 'text-success' },
  neutral: { box: 'bg-muted ring-border', accent: 'text-muted-foreground' },
}

export type CalloutTone = keyof typeof TONES

/** A tinted notice in the flow of a page: an icon, a title, a body and actions on the right. */
export function Callout({
  tone = 'info',
  icon: Icon,
  title,
  actions,
  children,
  className,
  ...props
}: {
  tone?: CalloutTone
  icon?: LucideIcon
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
} & Omit<ComponentProps<'div'>, 'title'>) {
  const { box, accent } = TONES[tone]
  return (
    <div
      data-slot="callout"
      data-tone={tone}
      className={cn(
        'flex gap-3 rounded-xl px-4 py-3 text-body-sm ring-1 ring-inset',
        // A body-only notice with actions is one line beside its buttons, so it centres on them.
        !title && actions ? 'items-center' : 'items-start',
        box,
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn('size-4 shrink-0', (title || !actions) && 'mt-px', accent)}
        />
      )}
      <div className="grid min-w-0 flex-1 gap-1">
        {title && <p className={cn('text-body font-medium', accent)}>{title}</p>}
        {children && <div className="text-pretty text-foreground">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  )
}
