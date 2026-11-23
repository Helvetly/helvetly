'use client'
import { cn } from 'cn'
import { useRef, useState } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

/** One line of text cut with "…"; hovering or focusing it shows the whole text, but only when it is cut. */
export function TruncatedText({ children, className }: { children: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const element = ref.current
        setOpen(next && !!element && element.scrollWidth > element.clientWidth)
      }}
    >
      <TooltipTrigger asChild>
        <span ref={ref} data-slot="truncated-text" className={cn('min-w-0 truncate', className)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="break-words">{children}</TooltipContent>
    </Tooltip>
  )
}
