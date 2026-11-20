import { Button } from '@helvetly/ui/components/button'
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
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={open}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn('relative z-[1] text-muted-foreground', className)}
    >
      <EllipsisVertical />
    </Button>
  )
}
