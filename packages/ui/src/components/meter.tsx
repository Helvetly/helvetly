import { cn } from '@helvetly/ui/lib/utils'

/** Where a meter turns orange, then red: a share of `max`. */
export const METER_WARNING = 0.75
export const METER_DANGER = 0.9

/** The calm brand colour while there is room, orange (warning) from 75 %, red from 90 % and past it. */
export function meterTone(value: number, max: number): 'brand' | 'warning' | 'danger' {
  const share = max > 0 ? value / max : 0
  return share >= METER_DANGER ? 'danger' : share >= METER_WARNING ? 'warning' : 'brand'
}

const FILL = { brand: 'bg-brand-solid', warning: 'bg-warning-solid', danger: 'bg-destructive' }

/**
 * A thin progress bar. Past `max` the bar rescales and the overage shows as a danger segment;
 * `marker` (0–max) draws a tick, e.g. where usage is expected by today. The numbers belong in
 * text next to it; the bar is for the eye, with a hidden <progress> for assistive tech.
 */
export function Meter({
  value,
  max,
  label,
  marker,
  size = 'sm',
  tone,
  className,
}: {
  value: number
  max: number
  label: string
  marker?: number
  size?: 'sm' | 'lg'
  /** A fixed colour for a bar that is no limit (time passing): no orange or red near the end. */
  tone?: 'brand'
  className?: string
}) {
  const shade = tone ?? meterTone(value, max)
  const scale = Math.max(value, max, 0) || 1
  const within = Math.max(0, Math.min(value, max))
  const over = Math.max(0, value - max)
  const pct = (part: number) => `${((part / scale) * 100).toFixed(2)}%`
  return (
    <div className={cn('grid', className)}>
      <progress className="sr-only" aria-label={label} max={max} value={within} />
      <div
        aria-hidden
        data-slot="meter"
        data-tone={shade}
        className={cn(
          'relative flex w-full overflow-hidden rounded-full bg-muted ring-1 ring-foreground/[0.04] ring-inset',
          size === 'lg' ? 'h-2.5' : 'h-1.5',
        )}
      >
        <span
          data-part="used"
          className={cn('h-full transition-[width] duration-500', FILL[shade])}
          // A sliver for any use, so 1 of 1000 still shows.
          style={{ width: within > 0 ? `max(${pct(within)}, 2px)` : '0%' }}
        />
        {over > 0 && (
          <span
            data-part="overage"
            className="h-full bg-destructive"
            style={{ width: pct(over) }}
          />
        )}
        {marker !== undefined && (
          <span
            data-part="marker"
            className="absolute inset-y-0 w-px bg-foreground/60"
            style={{ left: pct(Math.min(marker, max)) }}
          />
        )}
      </div>
    </div>
  )
}
