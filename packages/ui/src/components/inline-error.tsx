import { Callout } from '@helvetly/ui/components/callout'
import { cn } from '@helvetly/ui/lib/utils'
import { CircleAlert } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

/** A standalone failure in the flow of a form or dialog: a compact destructive-tinted notice, announced as an alert. */
export function InlineError({
  className,
  children,
  ...props
}: { children: ReactNode } & Omit<ComponentProps<'div'>, 'title'>) {
  return (
    <Callout
      tone="danger"
      role="alert"
      className={cn('rounded-lg px-3 py-2', className)}
      {...props}
    >
      {children}
    </Callout>
  )
}

/** A field's error under its input: small, with the alert icon. */
export function FieldError({ className, children, ...props }: ComponentProps<'p'>) {
  return (
    <p className={cn('flex items-start gap-1 text-xs text-destructive', className)} {...props}>
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      {children}
    </p>
  )
}
