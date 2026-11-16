import { cn } from '@helvetly/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'

const VARIANTS = {
  /** A card or section title: the brand tile. */
  section: 'bg-brand-surface text-brand',
  /** A row in a list: an outlined tile that never competes with the section's. */
  row: 'bg-card text-muted-foreground ring-1 ring-border ring-inset',
  /** A category (a notification type): neutral, the icon tells the type. */
  neutral: 'bg-muted text-muted-foreground',
  /** Heidi and AI, the only coloured category. */
  heidi: 'bg-heidi-soft text-heidi',
}

const SIZES = {
  sm: 'size-7 rounded-md [&_svg]:size-3.5',
  md: 'size-8 rounded-lg [&_svg]:size-4',
  lg: 'size-10 rounded-xl [&_svg]:size-5',
}

export type IconTileVariant = keyof typeof VARIANTS

/** An icon on a small rounded tile. */
export function IconTile({
  icon: Icon,
  variant = 'neutral',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  variant?: IconTileVariant
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      data-slot="icon-tile"
      data-variant={variant}
      className={cn(
        'flex shrink-0 items-center justify-center',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      <Icon aria-hidden className="stroke-[1.75]" />
    </span>
  )
}
