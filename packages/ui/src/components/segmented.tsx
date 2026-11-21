import { segmentItem, segmentText, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { Children, useId, type ReactNode } from 'react'

/** Wraps a segment's text so it keeps its semibold width (`segmentText`); icons and other nodes pass through. */
export function segmentLabels(children: ReactNode) {
  return Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? (
      <span data-text={child} className={segmentText}>
        {child}
      </span>
    ) : (
      child
    ),
  )
}

/** A row of mutually exclusive choices ("Company | Person", "10 | 30 | 60 | Custom"). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  fill = false,
  size = 'md',
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
  /**
   * `md` (default): the height of a form field (36 px), so a segmented choice and an input beside it line up and
   * a field appearing next to it never moves the row. `sm` (32 px): compact toolbars whose other controls are 32 px.
   */
  size?: 'sm' | 'md'
}) {
  // One radio group per control, even when two share a label.
  const name = useId()
  return (
    // Stretches to the height of a neighbouring field; the options fill it, so the padding stays even.
    <fieldset
      className={cn(segmentTrack, fill ? 'grid w-full auto-cols-fr grid-flow-col' : 'flex w-fit')}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            segmentItem,
            size === 'sm' ? 'min-h-6' : 'min-h-7',
            // Filling a narrow field, a long option wraps instead of running off the page.
            fill && 'py-0.5 text-center text-balance whitespace-normal',
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
          {segmentLabels(option.label)}
          {option.count !== undefined && (
            <span className="font-normal text-muted-foreground tabular-nums">{option.count}</span>
          )}
        </label>
      ))}
    </fieldset>
  )
}
