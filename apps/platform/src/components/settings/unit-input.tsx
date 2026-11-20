import { fieldSurface } from '@helvetly/ui/lib/field-surface'
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
      data-field-surface
      className={cn(fieldSurface, 'flex h-9 w-full min-w-0 items-center gap-2 px-3', className)}
    >
      <input
        {...input}
        className="h-full w-full min-w-0 flex-1 bg-transparent text-body tabular-nums outline-none placeholder:text-placeholder"
      />
      <span className="shrink-0 text-body-sm whitespace-nowrap text-muted-foreground">{unit}</span>
    </div>
  )
}
