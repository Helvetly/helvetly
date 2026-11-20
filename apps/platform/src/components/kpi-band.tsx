'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { useRef, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'

/**
 * The light band of key figures under the tabs: a horizontal snap scroll in a phone-wide panel,
 * otherwise a grid that wraps. Sized by the panel (container), not the window, so the sidebar and
 * Heidi's panel never push a figure out of view.
 */
export function KpiBand({ loading, children }: { loading: boolean; children: ReactNode }) {
  const scroll = useRef<HTMLElement>(null)
  const page = (direction: number) => {
    const region = scroll.current
    region?.scrollBy({ left: direction * region.clientWidth, behavior: 'smooth' })
  }
  return (
    <section
      ref={scroll}
      aria-label={translate('keyFigures')}
      className="relative flex shrink-0 snap-x snap-mandatory overflow-x-auto border-b @xl:grid @xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] @xl:overflow-visible"
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={translate('scrollKeyFigures')}
        title={translate('useTheLeftAndRightArrowKeysToScroll')}
        className="sr-only absolute top-2 right-2 z-10 focus:not-sr-only @xl:hidden"
        onClick={() => page(1)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            page(event.key === 'ArrowRight' ? 1 : -1)
          }
        }}
      >
        <ArrowRight />
      </Button>
      {loading ? <Loader className="col-span-full min-h-36" /> : children}
    </section>
  )
}

const CHART_TONES = {
  brand: 'text-brand-solid',
  success: 'text-success-solid',
  warning: 'text-warning-solid',
}

/** One figure: label (with a tiny arrow badge when it trends), the number, a small chart. */
export function Kpi({
  label,
  value,
  unit,
  note,
  trending = false,
  chart,
  tone = 'brand',
}: {
  label: string
  value: string
  /** Shown small before the number, e.g. "CHF". */
  unit?: string
  /** Muted superscript after the number, e.g. "94%". */
  note?: string
  trending?: boolean
  chart: ReactNode
  /** The chart's colour: the brand blue, green for money in, amber for what needs attention. */
  tone?: keyof typeof CHART_TONES
}) {
  return (
    <div className="grid min-w-[62%] snap-start content-start gap-2.5 px-5 pt-5 pb-4 @xl:min-w-0">
      <p className="flex items-center gap-1.5 truncate text-[14px]">
        {label}
        {trending && (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-success-surface text-success">
            <ArrowUpRight className="size-3" strokeWidth={2.25} />
          </span>
        )}
      </p>
      <p className="flex items-start gap-1 text-[30px] leading-none font-normal tracking-[-0.02em] tabular-nums">
        {unit && (
          <span className="mt-1 mr-0.5 text-[13px] tracking-normal text-muted-foreground">
            {unit}
          </span>
        )}
        {value}
        {note && (
          <span className="mt-0.5 ml-1 text-[11px] tracking-normal whitespace-nowrap text-muted-foreground">
            {note}
          </span>
        )}
      </p>
      <div className={`mt-2 h-8 ${CHART_TONES[tone]}`}>{chart}</div>
    </div>
  )
}

/** A thin line through `values` (any scale), ending in a dot. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const step = 100 / Math.max(values.length - 1, 1)
  const y = (value: number) => (max === min ? 24 : 28 - ((value - min) / (max - min)) * 22)
  const points = values.map((value, i) => `${i * step},${y(value)}`).join(' ')

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden
      className="size-full overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="100" cy={y(values.at(-1) ?? 0)} r="1.8" fill="currentColor" />
    </svg>
  )
}

/** Hairline ticks with a ▼ marker at `share` (0 to 1); ticks up to the marker are dark. */
export function TickGauge({ share }: { share: number }) {
  const ticks = 64
  const at = Math.round(Math.min(Math.max(share, 0), 1) * (ticks - 1))

  return (
    <svg
      viewBox={`0 0 ${ticks * 3} 32`}
      preserveAspectRatio="none"
      aria-hidden
      className="size-full"
    >
      <path d={`M${at * 3 - 2} 4h5l-2.5 4z`} fill="currentColor" />
      {Array.from({ length: ticks }, (_, i) => (
        <line
          key={i}
          x1={i * 3 + 0.5}
          x2={i * 3 + 0.5}
          y1={i === at ? 11 : 14}
          y2={i === at ? 29 : 24}
          stroke="currentColor"
          opacity={i <= at ? 0.85 : 0.22}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
