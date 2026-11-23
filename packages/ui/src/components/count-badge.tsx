import { cn } from 'cn'

/** A count after a name in a sidebar or menu: a caption-size figure in a soft round badge, flush right. */
export function CountBadge({
  children,
  label,
  className,
}: {
  children: number
  /** The count in words for screen readers, when the figure alone is unclear. */
  label?: string
  className?: string
}) {
  return (
    <span
      data-slot="count-badge"
      className={cn(
        'ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-caption leading-none font-medium text-muted-foreground tabular-nums',
        className,
      )}
    >
      <span aria-hidden={label ? true : undefined}>{children}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
