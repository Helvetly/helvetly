import { cn } from 'cn'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A section that opens and closes, and looks like it: a tinted, bordered row with a chevron that
 * turns, an optional count badge and description, then the content in a sub-panel below it.
 * Native `<details>`, so keyboard, find-in-page and screen readers work without state.
 */
function Disclosure({
  label,
  count,
  description,
  icon: Icon,
  defaultOpen,
  className,
  children,
}: {
  label: ReactNode
  count?: number
  description?: ReactNode
  icon?: LucideIcon
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <details
      data-slot="disclosure"
      open={defaultOpen}
      className={cn('group/disclosure rounded-lg border border-border bg-muted/50', className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[calc(var(--radius-lg)-1px)] px-3 py-2.5 transition-colors outline-none group-open/disclosure:rounded-b-none hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open/disclosure:rotate-90"
        />
        {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
            {label}
            {count !== undefined && (
              <span className="rounded-full bg-card px-1.5 text-[11.5px] leading-[18px] font-medium text-muted-foreground tabular-nums ring-1 ring-border">
                {count}
              </span>
            )}
          </span>
          {description && (
            <span className="text-[12.5px] text-pretty text-muted-foreground">{description}</span>
          )}
        </span>
      </summary>
      <div className="rounded-b-[calc(var(--radius-lg)-1px)] border-t border-border bg-card py-1 pl-6">
        {children}
      </div>
    </details>
  )
}

export { Disclosure }
