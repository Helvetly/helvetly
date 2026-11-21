import { cn } from '@helvetly/ui/lib/utils'

/** A name or value to copy or type exactly, set off from the sentence around it like inline code. */
export function InlineCode({ className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      data-slot="inline-code"
      className={cn(
        'font-code rounded-md border border-border bg-muted px-1.5 py-0.5 font-medium break-all text-foreground select-text',
        className,
      )}
      {...props}
    />
  )
}
