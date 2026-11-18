import { cn } from 'cn'

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 shrink-0 items-center justify-center gap-1 rounded border border-border bg-card px-1.5 font-sans text-caption leading-none font-medium whitespace-nowrap text-muted-foreground select-none in-data-[slot=tooltip-content]:border-background/25 in-data-[slot=tooltip-content]:bg-transparent in-data-[slot=tooltip-content]:text-background [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
