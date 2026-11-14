import { cn } from 'cn'
import { useId } from 'react'

/**
 * Heidi's icon in menus and lists: the familiar outline sparkle, stroked with her violet-to-magenta
 * gradient. Still by default; its two small crosses twinkle under a hovered link or button, and
 * always when `animated`. Nothing moves with reduced motion.
 */
export function HeidiSparkle({
  className,
  animated = false,
}: {
  className?: string
  animated?: boolean
}) {
  const id = useId()
  const twinkle = animated
    ? 'motion-safe:animate-twinkle'
    : 'motion-safe:in-[a:hover,button:hover]:animate-twinkle'
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={`url(#${id})`}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
    >
      <defs>
        {/* Colours as CSS, never as attributes: SVG presentation attributes ignore var() in Safari. */}
        <linearGradient id={id} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--heidi-from, #7b3dff)' }} />
          <stop offset="1" style={{ stopColor: 'var(--heidi-to, #e93dff)' }} />
        </linearGradient>
      </defs>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <g style={{ transformBox: 'fill-box' }} className={cn('origin-center', twinkle)}>
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
      </g>
      <g
        style={{ transformBox: 'fill-box', animationDelay: '-1.3s' }}
        className={cn('origin-center', twinkle)}
      >
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </g>
    </svg>
  )
}

/**
 * Heidi's orb: a glossy violet-and-magenta sphere whose colours swirl slowly inside it, with a soft
 * highlight and halo. `animated` swirls and floats it; without it the orb rests. Its size comes from
 * `className` (a square, e.g. `size-7`).
 */
function Orb({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <span aria-hidden className={cn('heidi-orb', animated && 'heidi-orb-alive', className)}>
      <span className="heidi-orb-swirl" />
      <span className="heidi-orb-gloss" />
    </span>
  )
}

/** Heidi's avatar beside her messages and in the panel header: a small orb, alive while she works. */
export function HeidiMark({ className, animated }: { className?: string; animated?: boolean }) {
  return <Orb animated={animated} className={cn('size-7 shrink-0', className)} />
}

/** The introduction's orb (the empty panel and the welcome): larger, with a glow, always alive. */
export function HeidiOrb({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-[72px]', className)}>
      <span className="heidi-orb-halo" />
      <Orb animated className="heidi-orb-lg relative size-full" />
    </span>
  )
}
