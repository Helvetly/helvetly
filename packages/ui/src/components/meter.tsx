import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
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
  markerLabel,
  size = 'sm',
  tone,
  className,
}: {
  value: number
  max: number
  label: string
  marker?: number
  /** Names the marker for a tooltip on hover and focus, e.g. "Expected by now: 28.6 h". */
  markerLabel?: string
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
    <div className={cn('relative grid', className)}>
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
      </div>
      {marker !== undefined && (
        <MeterMarker left={pct(Math.min(marker, max))} label={markerLabel} />
      )}
    </div>
  )
}

/**
 * A 2px notch in the card's own colour, outlined, that pokes past the bar above and below: it reads on the
 * coloured fill and on the grey track alike, in both themes. Out of the bar's box, so nothing moves.
 */
function MeterMarker({ left, label }: { left: string; label?: string }) {
  const notch = (
    <span
      data-part="marker"
      className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-background ring-1 ring-foreground/35"
    />
  )
  const box = 'absolute inset-y-[-3px] w-3 -translate-x-1/2'
  if (!label)
    return (
      <span aria-hidden className={box} style={{ left }}>
        {notch}
      </span>
    )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Wider than the notch, so the tooltip is reachable by pointer and keyboard. */}
        <button
          type="button"
          aria-label={label}
          className={cn(
            box,
            'cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
          style={{ left }}
        >
          {notch}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
