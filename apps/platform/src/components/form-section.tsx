'use client'

import { HelpTip } from '@helvetly/ui/components/form-field'
import { FieldError } from '@helvetly/ui/components/inline-error'
import { Check, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'

import { SectionIcon } from '@/components/section-form'

/**
 * A settings-style form row: the section's name and a short sentence in a 220px column, its fields in
 * a column of at most 560px. Sections are divided by a hairline; below `lg` the columns stack.
 * Put the sections directly in the scrolling form area.
 */
export function FormSection({
  icon,
  title,
  description,
  tip,
  action,
  children,
}: {
  /** The section's icon tile before the title, as in settings. */
  icon: LucideIcon
  title: string
  description?: string
  /** Help behind a (?) next to the title. */
  tip?: string
  /** E.g. a picker, under the description. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 border-b border-border/60 px-5 py-8 last:border-b-0 md:px-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <header className="grid content-start gap-1">
        <span className="flex items-center gap-1.5">
          <SectionIcon icon={icon} className="mr-1" />
          <h3 className="text-[15px] font-semibold">{title}</h3>
          {tip && <HelpTip label={title}>{tip}</HelpTip>}
        </span>
        {description && (
          <p className="line-clamp-2 text-[13px] text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-2">{action}</div>}
      </header>
      {/* min-w-0: a wide row of controls shrinks to the column instead of scrolling the sheet sideways. */}
      <div className="grid max-w-[560px] min-w-0 content-start gap-5 [&>*]:min-w-0">{children}</div>
    </section>
  )
}

export type FormChoice<T extends string> = {
  value: T
  title: string
  text: string
  icon: LucideIcon
}

/**
 * Mutually exclusive choices as a stack of full-width rows (native radios: the arrow keys move the choice).
 * One column at every width, so a long title or a German description never wraps into a narrow card;
 * every row takes the tallest one's height.
 */
export function FormChoiceCards<T extends string>({
  label,
  value,
  options,
  error,
  onChange,
}: {
  label: string
  value: T
  options: FormChoice<T>[]
  /** Shown under the choices, e.g. for an imported value that is none of them. */
  error?: string
  onChange: (value: T) => void
}) {
  const group = useId()
  const cards = (
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${group}-error` : undefined}
      className="grid auto-rows-fr gap-2"
    >
      {options.map(({ value: option, title, text, icon: Icon }) => {
        const id = `${group}-${option}`
        return (
          <label
            key={option}
            className="group/choice flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/30 has-checked:border-foreground/80 has-checked:bg-muted/40 has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name={group}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-text`}
              className="sr-only"
            />
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-has-checked/choice:text-foreground"
            >
              <Icon className="size-4 stroke-[1.75]" />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span id={`${id}-title`} className="text-[13.5px] font-medium">
                {title}
              </span>
              <span id={`${id}-text`} className="text-[12.5px] text-muted-foreground">
                {text}
              </span>
            </span>
            <span
              aria-hidden
              className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input group-has-checked/choice:border-foreground group-has-checked/choice:bg-foreground group-has-checked/choice:text-background"
            >
              <Check className="hidden size-2.5 stroke-[3] group-has-checked/choice:block" />
            </span>
          </label>
        )
      })}
    </div>
  )
  if (!error) return cards
  return (
    <div className="grid gap-1.5">
      {cards}
      <FieldError id={`${group}-error`}>{error}</FieldError>
    </div>
  )
}
