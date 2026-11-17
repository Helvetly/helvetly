import { cn } from '@helvetly/ui/lib/utils'
import { useId, type ReactNode } from 'react'

/** A row of mutually exclusive choices ("Company | Person", "10 | 30 | 60 | Custom"). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  fill = false,
}: {
  label: string
  /** null: none of the options is chosen (the state was set elsewhere). */
  value: T | null
  /**
   * `name`: what is spoken when the visible label is abbreviated ("3 mo" for "3 months").
   * `count`: how many records the option holds, shown muted after its label.
   */
  options: { value: T; label: ReactNode; name?: string; count?: number }[]
  onChange: (value: T) => void
  /** Spans the field's width in equal parts, for a row under an input. */
  fill?: boolean
}) {
  // One radio group per control, even when two share a label.
  const name = useId()
  return (
    // Stretches to the height of a neighbouring field; the options fill it, so the padding stays even.
    <fieldset
      className={cn(
        'items-stretch rounded-lg bg-foreground/6 p-0.5',
        fill ? 'grid w-full auto-cols-fr grid-flow-col' : 'flex w-fit',
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'relative flex min-h-7 items-center justify-center rounded-md px-3 text-body-sm text-muted-foreground transition-colors duration-150 hover:text-foreground has-checked:bg-card has-checked:text-foreground has-checked:shadow-elevation-1 has-focus-visible:ring-2 has-focus-visible:ring-ring/50',
            // Filling a narrow field, a long option wraps instead of running off the page.
            fill ? 'py-1 text-center text-balance' : 'whitespace-nowrap',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            aria-label={option.name}
            onChange={() => onChange(option.value)}
            // Covers the whole option, so a click (or a test's `check()`) lands on the radio itself.
            className="absolute inset-0 cursor-pointer appearance-none opacity-0"
          />
          {option.label}
          {option.count !== undefined && (
            <span className="ml-1.5 text-muted-foreground tabular-nums">{option.count}</span>
          )}
        </label>
      ))}
    </fieldset>
  )
}
