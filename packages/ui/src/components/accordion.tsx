'use client'

import { cn } from 'cn'
import { ChevronRight } from 'lucide-react'
import { Accordion as AccordionPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'

/** Sections that open and close, divided by hairlines, no boxes (Radix: arrow keys move between headers). */
function Accordion({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn('grid divide-y divide-border', className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('py-1', className)}
      {...props}
    />
  )
}

/**
 * The header: a chevron and the children as the toggle, and `actions` beside it, outside the button,
 * so controls in the header (a switch for the whole section) stay their own focus stops.
 */
function AccordionTrigger({
  className,
  children,
  actions,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger> & { actions?: ReactNode }) {
  return (
    <div
      data-slot="accordion-header"
      className="flex items-center rounded-md transition-colors hover:bg-muted/60"
    >
      <AccordionPrimitive.Header className="flex min-w-0 flex-1">
        <AccordionPrimitive.Trigger
          data-slot="accordion-trigger"
          className={cn(
            'group/trigger flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
            className,
          )}
          {...props}
        >
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/trigger:rotate-90"
          />
          {children}
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      {actions}
    </div>
  )
}

function AccordionContent({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        'overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
