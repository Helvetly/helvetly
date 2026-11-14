import { cn } from '@helvetly/ui/lib/utils'
import { EllipsisVertical } from 'lucide-react'
import type { MouseEvent } from 'react'

function open(event: MouseEvent<HTMLButtonElement>) {
  event.stopPropagation()
  const box = event.currentTarget.getBoundingClientRect()
  event.currentTarget.dispatchEvent(
    new globalThis.MouseEvent('contextmenu', {
      bubbles: true,
      clientX: box.left,
      clientY: box.bottom + 4,
    }),
  )
}

/** A "⋮" that opens the surrounding right-click menu where it stands, so both are one menu. */
export function MenuButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={open}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        'relative z-[1] flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      <EllipsisVertical className="size-4" />
    </button>
  )
}
