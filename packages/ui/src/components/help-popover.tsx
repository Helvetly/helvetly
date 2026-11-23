'use client'

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@helvetly/ui/components/popover'
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'

/** A (?) that opens a short explanation on click or Enter: for more than a tooltip's line, and usable on phones. */
export function HelpPopover({
  label,
  title,
  children,
}: {
  /** The button's accessible name, e.g. "About self-billing". */
  label: string
  title: string
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:text-foreground"
        >
          <CircleHelp className="size-4 stroke-[1.75]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-80 max-w-[calc(100vw-24px)] gap-2 p-4 text-body-sm"
      >
        <PopoverTitle className="text-sm">{title}</PopoverTitle>
        {children}
      </PopoverContent>
    </Popover>
  )
}
