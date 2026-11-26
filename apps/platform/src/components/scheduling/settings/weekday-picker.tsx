import { cn } from '@helvetly/ui/lib/utils'

import { weekdayName } from '@/lib/scheduling-settings'

/** Mon … Sun as toggle buttons (ISO numbers, 1 = Monday). */
export function WeekdayPicker({
  label,
  value,
  onChange,
  className,
}: {
  label: string
  value: number[]
  onChange: (days: number[]) => void
  className?: string
}) {
  return (
    <fieldset aria-label={label} className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
      {[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const on = value.includes(day)
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            className={cn(
              'h-8 min-w-11 rounded-full border px-3 text-body-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
              on
                ? 'border-transparent bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() =>
              onChange(on ? value.filter((d) => d !== day) : [...value, day].toSorted())
            }
          >
            {weekdayName(day)}
          </button>
        )
      })}
    </fieldset>
  )
}
