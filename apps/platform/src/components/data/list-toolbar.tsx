import { cn } from '@helvetly/ui/lib/utils'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'

/** The bar above a list: filters, search and view controls on one vertically centred row. */
export function ListToolbar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('flex min-h-12 shrink-0 items-center gap-1 border-b px-2 md:px-3', className)}
    >
      {children}
    </div>
  )
}

/** The list's search field: grows to fill the toolbar between its other controls. */
export function ListSearch({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex h-8 min-w-0 flex-1 cursor-text items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:text-foreground',
        className,
      )}
    >
      <Search className="size-4 shrink-0 stroke-[1.5]" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // A full-height input centres its text by the font box, which lands on the icons' centre without a nudge.
        className="h-full w-full min-w-0 bg-transparent text-title-sm text-foreground outline-none placeholder:text-placeholder"
      />
    </label>
  )
}
