import { fieldClass } from '@helvetly/ui/lib/field-surface'
import { cn } from 'cn'
import * as React from 'react'

/** The one look of every field: see `@helvetly/ui/lib/field-surface`. */
export const inputClass = fieldClass

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
