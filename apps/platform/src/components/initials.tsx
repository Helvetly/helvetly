import { cn } from '@helvetly/ui/lib/utils'

export const initialsOf = (name: string) =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

/** A 28px light-gray circle with two tiny uppercase letters. */
export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f1f1f2] text-[10px] font-semibold tracking-wide text-[#404042] shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-black/[0.05] ring-inset dark:bg-muted dark:text-muted-foreground',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/** Initials and a name, as the first cell of a row. */
export function Person({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <Initials name={name} />
      <span className="truncate">{name}</span>
    </span>
  )
}
