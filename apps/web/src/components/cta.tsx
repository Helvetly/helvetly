import { localizedHref } from '@helvetly/i18n'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

// The website's call-to-action pill: larger and rounder than the app's buttons, one role per variant.
const variants = {
  // The brand's teal, lit from above; hover deepens it (no lift, no shadow change).
  primary:
    'bg-linear-to-b from-mint-solid to-brand text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_24px_-10px_var(--mint-solid)] hover:from-brand hover:to-brand',
  outline:
    // A solid surface with a clear edge, so it reads on the hero's pale grid in both themes.
    'border border-foreground/15 bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)] backdrop-blur hover:border-lilac-solid/40 hover:bg-lilac',
  light: 'bg-white text-black hover:bg-white/90',
}

export function Cta({
  href,
  children,
  variant = 'primary',
  arrow = variant === 'primary',
  className,
  disabled = false,
}: {
  href: string
  children: ReactNode
  variant?: keyof typeof variants
  arrow?: boolean
  className?: string
  /** Inert: a disabled button in place of the link. */
  disabled?: boolean
}) {
  const external = href.startsWith('http')
  const classes = cn(
    'inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-center text-body font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    variants[variant],
    className,
  )
  const content = (
    <>
      {children}
      {arrow && <ArrowRight aria-hidden className="size-4 shrink-0" />}
    </>
  )
  if (disabled)
    return (
      <button type="button" disabled className={cn(classes, 'cursor-not-allowed opacity-50')}>
        {content}
      </button>
    )
  return external ? (
    <a href={localizedHref(href)} className={classes}>
      {content}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {content}
    </Link>
  )
}
