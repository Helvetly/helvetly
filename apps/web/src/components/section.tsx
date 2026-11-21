import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import { type Tone, TONES } from '@/lib/tones'

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>
}

/** A small pill above a headline, with a dot in the section's tone. */
export function Eyebrow({
  children,
  tone = 'mint',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-body-sm font-medium',
        TONES[tone].surface,
        TONES[tone].ink,
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', TONES[tone].dot)} />
      {children}
    </span>
  )
}

/** A section's eyebrow, headline and lead, centred unless `align="left"`. */
export function SectionHeading({
  eyebrow,
  tone,
  title,
  lead,
  align = 'center',
  className,
}: {
  eyebrow?: ReactNode
  tone?: Tone
  title: ReactNode
  lead?: ReactNode
  align?: 'center' | 'left'
  className?: string
}) {
  return (
    <div
      data-reveal
      className={cn(
        'flex max-w-4xl flex-col gap-4',
        align === 'center' ? 'mx-auto items-center text-center' : 'items-start',
        className,
      )}
    >
      {eyebrow && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
      <h2 className="text-headline max-w-2xl font-semibold text-balance">{title}</h2>
      {lead && <p className="text-lead text-balance text-muted-foreground">{lead}</p>}
    </div>
  )
}
