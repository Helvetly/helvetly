import { ContextMenuItem } from '@helvetly/ui/components/context-menu'
import { cn } from '@helvetly/ui/lib/utils'
import { Star, StarOff } from 'lucide-react'

import type { Folder } from '@/lib/documents'
import { translate } from '@/lib/i18n'

/** The filled yellow star of a starred folder. */
export function StarGlyph({ className }: { className?: string }) {
  return (
    <Star
      aria-hidden
      className={cn(
        'fill-[#f5c84c] stroke-[#e5b432] dark:fill-[#f2cc5b] dark:stroke-[#f2cc5b]',
        className,
      )}
    />
  )
}

/** "Star" / "Unstar" for a folder, in any right-click menu. */
export function StarItem({
  folder,
  onToggle,
}: {
  folder: Folder
  onToggle: (folder: Folder) => void
}) {
  return (
    <ContextMenuItem onSelect={() => onToggle(folder)}>
      {folder.starred ? <StarOff /> : <Star />}{' '}
      {folder.starred ? translate('unstar') : translate('star')}
    </ContextMenuItem>
  )
}
