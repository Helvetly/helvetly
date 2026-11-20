import { cn } from 'cn'
import * as React from 'react'

/**
 * The one look of every field one types into or picks from (inputs, textareas, selects, combobox triggers,
 * input groups): a card-white box with a hairline border and a soft bottom shadow, 2.25rem high.
 */
export const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputClass,
        'file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
