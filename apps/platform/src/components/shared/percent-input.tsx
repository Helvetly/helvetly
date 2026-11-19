import { cn } from '@helvetly/ui/lib/utils'
import { useId, useState, type ChangeEvent, type ComponentProps, type FocusEvent } from 'react'

import { UnitInput } from '@/components/settings/unit-input'
import { translate } from '@/lib/i18n'
import { typedPercent } from '@/lib/percent'

type PercentInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: string
  onValueChange: (value: string) => void
  /** The unit after the number when it says more than "%" ("% a year"); only for the boxed field. */
  unit?: string
  /** The input's own look (a table cell, a compact total); without it the field is the boxed form field. */
  inputClassName?: string
  /** A narrow field: a tighter "%" in a smaller type. */
  compact?: boolean
}

/**
 * Every percentage in the app: takes only 0 to 100 with up to two decimals while one types or pastes, shows the
 * "%" inside the field and says what it takes, under the field without moving anything, when it refuses a key.
 */
export function PercentInput({
  value,
  onValueChange,
  unit = '%',
  className,
  inputClassName,
  compact = false,
  onBlur,
  ...input
}: PercentInputProps) {
  const [refused, setRefused] = useState(false)
  const hintId = useId()
  const describedBy = [input['aria-describedby'], refused ? hintId : undefined].filter(Boolean)
  const field = {
    ...input,
    inputMode: 'decimal' as const,
    autoComplete: 'off',
    value,
    'aria-describedby': describedBy.length ? describedBy.join(' ') : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const typed = typedPercent(event.target.value, value)
      setRefused(typed.refused)
      if (typed.value !== value) onValueChange(typed.value)
    },
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      setRefused(false)
      onBlur?.(event)
    },
  }
  const hint = refused && (
    <output
      id={hintId}
      className="absolute top-full left-0 z-20 mt-1 rounded-md border border-border bg-popover px-2 py-1 text-caption whitespace-nowrap text-popover-foreground"
    >
      {translate('percentFrom0To100')}
    </output>
  )

  if (!inputClassName)
    return (
      <div className={cn('relative', className)}>
        <UnitInput unit={unit} {...field} />
        {hint}
      </div>
    )
  return (
    <span className={cn('relative block', className)}>
      <input {...field} className={cn(inputClassName, compact ? 'pr-5' : 'pr-7')} />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 flex items-center text-muted-foreground',
          compact ? 'right-1.5 text-caption' : 'right-3 text-body-sm',
        )}
      >
        %
      </span>
      {hint}
    </span>
  )
}
