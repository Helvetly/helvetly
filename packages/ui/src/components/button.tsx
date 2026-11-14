import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Slot } from 'radix-ui'
import * as React from 'react'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Disabled: a quiet outlined chip with readable text, not a faded dark block.
        default:
          'border-primary bg-primary bg-clip-border text-primary-foreground shadow-[0_2px_6px_rgb(0_0_0/0.18),0_1px_1px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-primary/90 disabled:border-foreground/10 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none dark:shadow-none',
        outline:
          // Hover is darker than the page background (#efeef1): plain muted vanishes on it.
          'border-foreground/12 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.08),0_2px_4px_-1px_rgb(0_0_0/0.06)] hover:border-foreground/20 hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_11%)] hover:text-foreground aria-expanded:border-foreground/20 aria-expanded:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_11%)] aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:shadow-none dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] hover:text-foreground aria-expanded:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_6%)] aria-expanded:text-foreground dark:hover:bg-muted/50 dark:aria-expanded:bg-muted/50',
        // Destructive role, app-wide: every Remove/Delete/Revoke/Void is red and carries an icon.
        // Icons: Trash2 for deleting or removing a record; X only for dropping a chip or list
        // entry where a bin reads wrong (a tag, a filter, a staged upload).
        // `destructive` is the solid confirm (a dialog's "Delete client", a danger zone);
        // `destructive-ghost` is the quiet row-level action. Dark mode darkens the solid fill so
        // white text keeps AA contrast on the lighter dark-theme red.
        destructive:
          'border-destructive bg-destructive bg-clip-border text-white hover:bg-[color-mix(in_oklch,var(--destructive),black_12%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:border-transparent dark:bg-[color-mix(in_oklch,var(--destructive),black_38%)] dark:hover:bg-[color-mix(in_oklch,var(--destructive),black_45%)] dark:focus-visible:ring-destructive/40',
        // `destructive-outline`: a red-edged button for an irreversible action that sits among
        // other content (a danger zone row, "Sign out of all other sessions"), not in a dialog.
        'destructive-outline':
          'border-destructive/40 bg-card text-destructive hover:border-destructive/60 hover:bg-destructive/8 hover:text-destructive focus-visible:border-destructive/50 focus-visible:ring-destructive/20 aria-expanded:bg-destructive/8 dark:border-destructive/45 dark:bg-transparent dark:hover:bg-destructive/15 dark:focus-visible:ring-destructive/40',
        'destructive-ghost':
          'text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive/40 focus-visible:ring-destructive/20 aria-expanded:bg-destructive/10 dark:hover:bg-destructive/20 dark:focus-visible:ring-destructive/40',
        link: 'text-link underline underline-offset-4 hover:no-underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xl: 'h-10 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
