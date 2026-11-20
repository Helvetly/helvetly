import { inputClass } from '@helvetly/ui/components/input'
import { cn } from 'cn'
import * as React from 'react'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(inputClass, 'flex field-sizing-content h-auto min-h-16 py-2', className)}
      {...props}
    />
  )
}

export { Textarea }
