import { cn } from '@helvetly/ui/lib/utils'
import type { ReactNode } from 'react'

/** A card on the page: a quiet title row with an optional action, then the content. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      data-slot="panel"
      className={cn('rounded-xl bg-card px-4 pt-3 pb-4 shadow-elevation-1', className)}
    >
      {(title || action) && (
        <div className="mb-2 flex h-7 items-center justify-between gap-2">
          <h3 className="text-body-sm font-medium text-muted-foreground">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
