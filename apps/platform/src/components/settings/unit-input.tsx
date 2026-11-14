import { cn } from '@helvetly/ui/lib/utils'
import type { ComponentProps } from 'react'

/**
 * A short number with its unit inside the field ("10 days before due", "5 % a year"), so it fills
 * its column in the settings form grid like any other input instead of a narrow box and loose text.
 */
export function UnitInput({
  unit,
  className,
  ...input
}: ComponentProps<'input'> & { unit: string }) {
  return (
    <div
      data-slot="unit-input"
      className={cn(
        'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 shadow-xs transition-[color,box-shadow] has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:opacity-50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:bg-input/30',
        className,
      )}
    >
      <input
        {...input}
        className="h-full w-full min-w-0 flex-1 bg-transparent text-body tabular-nums outline-none placeholder:text-placeholder"
      />
      <span className="shrink-0 text-body-sm whitespace-nowrap text-muted-foreground">{unit}</span>
    </div>
  )
}
