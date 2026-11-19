'use client'
import { cn } from '@helvetly/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

/**
 * A description-like textarea with its tools (Write with AI) and its character count inside the field's border,
 * on a row of their own under the text, so the text never runs beneath them and an error never hides them.
 */
export function TextareaBox({
  max,
  tools,
  className,
  ...props
}: ComponentProps<'textarea'> & {
  /** Shows `length / max`, red past it. */
  max?: number
  /** Controls at the bottom left, e.g. AIWrite. */
  tools?: ReactNode
}) {
  const length = String(props.value ?? '').length
  return (
    <div
      data-slot="textarea-box"
      className="grid min-w-0 rounded-md border border-input bg-card shadow-xs transition-[color,box-shadow] has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-3 has-[textarea:focus-visible]:ring-ring/50 has-[textarea[aria-invalid=true]]:border-destructive has-[textarea[aria-invalid=true]]:ring-destructive/20 dark:bg-input/30"
    >
      <textarea
        {...props}
        className={cn(
          'min-h-20 w-full resize-y rounded-t-md bg-transparent px-3 pt-2 pb-1 text-sm outline-none placeholder:text-placeholder disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      />
      {(tools || max !== undefined) && (
        <div className="flex min-h-8 items-center gap-2 px-1.5 pb-1">
          {tools}
          {max !== undefined && (
            <span
              data-slot="textarea-count"
              className={cn(
                'ml-auto px-1.5 text-xs text-muted-foreground tabular-nums',
                length > max && 'text-destructive',
              )}
            >
              {length} / {max}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
