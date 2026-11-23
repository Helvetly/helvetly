'use client'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'

export type SegmentOption<T> = { value: T; label: string; text: string }

/**
 * Two or more choices, each a title with a line under it, on the segmented track. Every option has the same
 * padding, left edge and type sizes; choosing one changes only its pill and weight, never where its text starts.
 */
export function OptionSegments<T extends string | boolean>({
  label,
  value,
  onChange,
  options,
}: {
  /** Names the group for assistive technology (a visible label sits outside, if any). */
  label: string
  value: T
  onChange: (value: T) => void
  options: readonly SegmentOption<T>[]
}) {
  return (
    <fieldset className={cn(segmentTrack, 'grid auto-cols-fr grid-flow-col')}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          // segmentItem centres a label; here each column starts at the left edge, the same in every state.
          className={cn(
            segmentItem,
            'grid content-center justify-stretch justify-items-start gap-0.5 px-3 py-2 text-left whitespace-normal',
          )}
        >
          <span data-slot="option-title" className="text-sm">
            {option.label}
          </span>
          <span data-slot="option-text" className="text-xs font-normal text-muted-foreground">
            {option.text}
          </span>
        </button>
      ))}
    </fieldset>
  )
}
