import { cn } from '@helvetly/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

/** Each tone names its ink (text), surface (tint) and dot on the theme's semantic tokens; variants paint with them. */
const TONE_VARS = {
  neutral:
    '[--badge-ink:var(--muted-foreground)] [--badge-surface:var(--muted)] [--badge-dot:var(--muted-foreground)]',
  blue: '[--badge-ink:var(--info)] [--badge-surface:var(--info-surface)] [--badge-dot:var(--info-solid)]',
  green:
    '[--badge-ink:var(--success)] [--badge-surface:var(--success-surface)] [--badge-dot:var(--success-solid)]',
  amber:
    '[--badge-ink:var(--warning)] [--badge-surface:var(--warning-surface)] [--badge-dot:var(--warning-solid)]',
  red: '[--badge-ink:var(--destructive)] [--badge-surface:var(--destructive-surface)] [--badge-dot:var(--destructive)]',
  violet:
    '[--badge-ink:var(--violet)] [--badge-surface:var(--violet-surface)] [--badge-dot:var(--violet-solid)]',
}

export type Tone = keyof typeof TONE_VARS

export const BADGE_TONES = Object.keys(TONE_VARS) as Tone[]

const SOFT = 'bg-(color:--badge-surface) text-(color:--badge-ink)'

/** A tone's tint and ink, for anything that should match a badge: icon tiles, timeline marks. */
export const TONES = Object.fromEntries(
  BADGE_TONES.map((tone) => [tone, `${TONE_VARS[tone]} ${SOFT}`]),
) as Record<Tone, string>

const badgeVariants = cva(
  'inline-flex w-fit max-w-full shrink-0 items-center rounded-md border font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0',
  {
    variants: {
      /** soft: statuses (default). outline: secondary facts. solid: rare emphasis. dot: a status among neutral chrome. */
      variant: {
        soft: `border-(color:--badge-ink)/12 ${SOFT}`,
        outline: 'border-(color:--badge-ink)/30 bg-transparent text-(color:--badge-ink)',
        solid: 'border-transparent bg-(color:--badge-ink) text-background',
        dot: 'border-border bg-transparent text-foreground',
      },
      tone: TONE_VARS,
      size: {
        /** sm: beside a name in a list row, a count on a tab or a tag in dense chrome. */
        sm: 'h-5 gap-1 px-1.5 text-caption [&>svg]:size-3',
        md: 'h-6 gap-1.5 px-2 text-[13px] [&>svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'soft', tone: 'neutral', size: 'md' },
  },
)

/** A small label: a status ("Paid", "Overdue"), a tag ("Business"), a count. A lucide icon first is a leading icon. */
function Badge({
  className,
  variant,
  tone,
  size,
  children,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant ?? 'soft'}
      data-tone={tone ?? 'neutral'}
      className={cn(badgeVariants({ variant, tone, size }), className)}
      {...props}
    >
      {variant === 'dot' && (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(color:--badge-dot)" />
      )}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
