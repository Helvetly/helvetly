import { IconTile } from '@helvetly/ui/components/icon-tile'
import { cn } from '@helvetly/ui/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** What a list shows when it has nothing yet: a neutral tile, one sentence and one action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center gap-3 px-4 py-12 text-center text-pretty',
        className,
      )}
    >
      <IconTile icon={icon} size="lg" />
      <div className="grid max-w-sm gap-1">
        <p className="text-body font-medium">{title}</p>
        {description && <p className="text-body-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
