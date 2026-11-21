'use client'
import { FieldError } from '@helvetly/ui/components/inline-error'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { translate } from '@helvetly/ui/lib/i18n'
import { cn } from '@helvetly/ui/lib/utils'
import { CircleHelp } from 'lucide-react'
import { Children, type ReactNode } from 'react'

/**
 * A label (red with an error, a red asterisk when required, help behind a (?)) over its control,
 * then the error or a short status. `tip` and `hint` explain the field: both go behind the (?), so
 * nothing explanatory pushes the form apart; `status` is live feedback that stays under the control
 * (a check's result, a preview, an undo). The control gets `id`; its error has the id `${id}-error`.
 * `width` is the field's span in a settings form grid (settings.css); `group` labels a set of
 * controls (radios, a photo) rather than one input: a caption, as the controls name themselves
 * (a Segmented's legend). `mark` is a quiet sign after the label (what the field is needed for), in the label's
 * row so it never moves the control.
 */
export type FieldWidth = 'xs' | 'sm' | 'md' | 'lg' | 'full'

export function FormField({
  id,
  label,
  error,
  hint,
  status,
  required,
  tip,
  mark,
  width,
  group,
  className,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: ReactNode
  status?: ReactNode
  required?: boolean
  tip?: string
  mark?: ReactNode
  width?: FieldWidth
  group?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-slot="form-field"
      data-width={width}
      className={cn('grid min-w-0 content-start gap-1.5', className)}
    >
      <span className="flex items-center gap-1">
        <Label
          htmlFor={group ? undefined : id}
          className={cn('text-body-sm font-medium', error && 'text-destructive')}
        >
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
          )}
        </Label>
        {(tip || hint) && (
          <HelpTip label={label}>
            {tip && hint ? (
              <span className="grid gap-1">
                <span>{tip}</span>
                <span>{hint}</span>
              </span>
            ) : (
              (tip ?? hint)
            )}
          </HelpTip>
        )}
        {mark}
      </span>
      {/* Each control in a gap-free box: a zero-size node a browser extension adds beside an input
          (a password manager's icon host) would otherwise become a grid row and push the rest down by the gap. */}
      {Children.map(children, (child) =>
        child == null || typeof child === 'boolean' ? null : (
          <div className="grid min-w-0">{child}</div>
        ),
      )}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        status && <p className="text-xs text-muted-foreground">{status}</p>
      )}
    </div>
  )
}

/** A <label> for one control, or a plain caption for a group of them. */
function Label({
  htmlFor,
  ...props
}: {
  htmlFor?: string
  className: string
  children: ReactNode
}) {
  return htmlFor ? <label htmlFor={htmlFor} {...props} /> : <span {...props} />
}

/** A (?) next to a label that shows `children` on hover. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={translate('about', { label: label })}
          className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CircleHelp className="size-3.5 stroke-[1.75]" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">{children}</TooltipContent>
    </Tooltip>
  )
}

/** The props that tie a control to its FormField's label and error. */
export const describedBy = (id: string, error?: string) => ({
  id,
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error ? `${id}-error` : undefined,
})
