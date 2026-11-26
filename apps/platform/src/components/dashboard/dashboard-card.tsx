'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { HelpTip } from '@/components/settings/help-tip'
import { translate } from '@/lib/i18n'

/** The soft colour of a figure: its icon tile and its small chart. */
export const TONES = {
  brand: { tile: 'bg-brand-surface text-brand', chart: 'text-brand-solid' },
  success: { tile: 'bg-success-surface text-success', chart: 'text-success-solid' },
  warning: { tile: 'bg-warning-surface text-warning', chart: 'text-warning-solid' },
  violet: { tile: 'bg-violet-surface text-violet', chart: 'text-violet-solid' },
  info: { tile: 'bg-info-surface text-info', chart: 'text-info-solid' },
}
export type Tone = keyof typeof TONES

/** A tinted icon tile, the same in every dashboard card. */
export function ToneTile({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg',
        TONES[tone].tile,
      )}
    >
      <Icon className="size-[18px] stroke-[1.75]" />
    </span>
  )
}

/** One dashboard card: a title row (icon, title, help, "View all") over its content. */
export function DashboardCard({
  title,
  icon,
  tone = 'brand',
  help,
  viewAll,
  actions,
  className,
  children,
}: {
  title: string
  icon: LucideIcon
  tone?: Tone
  /** Explains the card in a (?) tooltip. */
  help?: string
  /** Where "View all" goes; `label` names it for assistive tech. */
  viewAll?: { href: string; label: string }
  /** Controls in the title row, before "View all". */
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    // A container: what a card shows follows its own width, wherever the page lays it out.
    <section
      className={cn('@container flex min-w-0 flex-col rounded-xl border bg-card', className)}
    >
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2">
        <ToneTile icon={icon} tone={tone} />
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-body font-medium">{title}</h2>
          {help && <HelpTip label={translate('aboutDynamic', { title })}>{help}</HelpTip>}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {actions}
          {viewAll && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="font-normal text-muted-foreground underline-offset-4 hover:underline"
            >
              <Link href={viewAll.href}>
                {translate('viewAll')}
                <span className="sr-only">: {viewAll.label}</span>
                <ArrowRight className="stroke-[1.5]" />
              </Link>
            </Button>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

/** One row of a card's list: a leading tile or avatar, title and meta, then whatever sits right. */
export const LIST_ROW =
  'flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-muted/60'
