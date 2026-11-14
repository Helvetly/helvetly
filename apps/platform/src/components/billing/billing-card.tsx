import { cn } from '@helvetly/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * One card of Plan & billing's overview: a title (the region's name), what it shows, an optional
 * action on the right, then its body under a hairline. Every card of the page shares it, so their
 * edges, paddings and titles line up.
 */
export function BillingCard({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-slot="billing-card"
      className={cn(
        '@container flex min-w-0 flex-col rounded-2xl bg-card shadow-elevation-1',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3.5">
        <div className="grid min-w-0 gap-0.5">
          <h2 id={`${id}-title`} className="text-body font-semibold">
            {title}
          </h2>
          {description && (
            <p className="text-body-sm text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </header>
      <div className="flex flex-1 flex-col border-t">{children}</div>
    </section>
  )
}
