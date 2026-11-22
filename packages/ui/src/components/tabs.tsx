'use client'

import { segmentLabels } from '@helvetly/ui/components/segmented'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
  {
    variants: {
      variant: {
        default: cn(segmentTrack, 'group-data-horizontal/tabs:h-9'),
        line: 'gap-1 rounded-none bg-transparent p-[3px] group-data-horizontal/tabs:h-8',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type TabsListVariant = NonNullable<VariantProps<typeof tabsListVariants>['variant']>

// The triggers take their list's look: segments in a track, or underlined page tabs.
const ListVariant = React.createContext<TabsListVariant>('default')

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <ListVariant.Provider value={variant ?? 'default'}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </ListVariant.Provider>
  )
}

const lineTrigger =
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 " +
  'after:absolute after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 data-active:after:opacity-100'

function TabsTrigger({
  className,
  children,
  icon: Icon,
  count,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  /** A lucide icon before the label: 16 px, muted until the tab is chosen. */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** How many records the tab holds, shown muted after the label; nothing for 0 or undefined. */
  count?: number
}) {
  const line = React.useContext(ListVariant) === 'line'
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        line
          ? lineTrigger
          : cn(
              segmentItem,
              'h-full flex-1 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start',
            ),
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden />}
      {line ? children : segmentLabels(children)}
      {Boolean(count) && (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      )}
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
