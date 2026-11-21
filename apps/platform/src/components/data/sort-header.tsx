import { cn } from '@helvetly/ui/lib/utils'
import { ArrowDown, ArrowUp } from 'lucide-react'

/** `aria-sort` for a column's `<th>`: only the sorted one says it. */
export const ariaSort = (sorted: boolean, desc: boolean) =>
  sorted ? (desc ? ('descending' as const) : ('ascending' as const)) : undefined

/** A sortable column's header label, as on the clients list: click to sort, again to reverse. */
export function SortButton({
  label,
  sorted,
  desc,
  onClick,
}: {
  label: string
  sorted: boolean
  desc: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 hover:text-foreground',
        sorted && 'text-foreground',
      )}
    >
      {label}
      {sorted && (desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
    </button>
  )
}
