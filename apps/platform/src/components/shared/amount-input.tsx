import { inputClass } from '@helvetly/ui/components/combobox'
import { cn } from '@helvetly/ui/lib/utils'
import { useId, useState, type ChangeEvent, type ComponentProps, type FocusEvent } from 'react'

import { typedAmount } from '@/lib/amount'
import { translate } from '@/lib/i18n'

type AmountInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: string
  onValueChange: (value: string) => void
  /** The currency code shown inside the field, before the number. */
  currency?: string
}

/**
 * A money amount: takes only digits with one decimal separator and at most two decimals while one types or pastes,
 * right-aligned, with the currency inside the field, and says what it takes, under the field without moving
 * anything, when it refuses a key.
 */
export function AmountInput({
  value,
  onValueChange,
  currency,
  className,
  onBlur,
  ...input
}: AmountInputProps) {
  const [refused, setRefused] = useState(false)
  const hintId = useId()
  const describedBy = [input['aria-describedby'], refused ? hintId : undefined].filter(Boolean)
  return (
    <span className="relative block">
      {currency && (
        <span
          aria-hidden
          data-slot="amount-currency"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body-sm text-muted-foreground"
        >
          {currency}
        </span>
      )}
      <input
        {...input}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-describedby={describedBy.length ? describedBy.join(' ') : undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const typed = typedAmount(event.target.value, value)
          setRefused(typed.refused)
          if (typed.value !== value) onValueChange(typed.value)
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          setRefused(false)
          onBlur?.(event)
        }}
        className={cn(inputClass, 'text-right tabular-nums', currency && 'pl-12', className)}
      />
      {refused && (
        <output
          id={hintId}
          className="absolute top-full left-0 z-20 mt-1 rounded-md border border-border bg-popover px-2 py-1 text-caption whitespace-nowrap text-popover-foreground"
        >
          {translate('amountFrom0')}
        </output>
      )}
    </span>
  )
}
