import { cn } from '@helvetly/ui/lib/utils'

import { translate } from '@/lib/i18n'

const SIZE = 96
const STROKE = 8
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Days left as a ring: the arc fills as time passes, the number of days left in the middle. Time
 * passing is no limit, so the ring stays the brand colour (muted when the plan is ending). A hidden
 * <progress> carries the value for assistive tech.
 */
export function Countdown({
  value,
  max,
  left,
  label,
  tone = 'brand',
}: {
  value: number
  max: number
  left: number
  label: string
  tone?: 'brand' | 'muted'
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <div
      data-slot="countdown"
      data-tone={tone}
      className="relative grid shrink-0 place-items-center"
    >
      <progress className="sr-only" aria-label={label} max={max} value={value} />
      <svg
        aria-hidden
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="-rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          className="fill-none stroke-foreground/[0.07]"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          className={cn(
            'fill-none transition-[stroke-dashoffset] duration-700',
            tone === 'brand' ? 'stroke-brand-solid' : 'stroke-muted-foreground/50',
            share === 0 && 'opacity-0',
          )}
        />
      </svg>
      <span aria-hidden className="absolute grid justify-items-center leading-none">
        <span className="text-page font-semibold tracking-[-0.02em] tabular-nums">{left}</span>
        <span className="mt-1 text-caption text-muted-foreground">
          {left === 1 ? 'day' : 'days'}
          {translate('left')}
        </span>
      </span>
    </div>
  )
}
