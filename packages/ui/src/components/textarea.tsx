import { cn } from 'cn'
import * as React from 'react'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A textarea that counts what is typed against its limit, in its own bottom-right corner (red once over), so the
 * person sees the room left where they write. `maxLength` is the limit; the field still refuses more.
 */
function CountedTextarea({
  className,
  maxLength,
  value,
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'maxLength'> & {
  value: string
  maxLength: number
}) {
  return (
    <div data-slot="counted-textarea" className="relative">
      <textarea value={value} maxLength={maxLength} className={cn(className, 'pb-7')} {...props} />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-3 bottom-2 text-caption text-muted-foreground tabular-nums',
          value.length >= maxLength && 'text-destructive',
        )}
      >
        {value.length} / {maxLength}
      </span>
    </div>
  )
}

export { CountedTextarea, Textarea }
