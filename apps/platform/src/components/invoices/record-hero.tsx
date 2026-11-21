import { cn } from '@helvetly/ui/lib/utils'
import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Initials } from '@/components/initials'
import { RecordLink } from '@/components/record-link'
import { translate } from '@/lib/i18n'

/**
 * A document at a glance (invoice, quote): who it is for, linked to the client (so its number need not be
 * repeated), the amount with its state, and beside it its dates and linked records as labelled facts.
 */
export function RecordHero({
  label,
  client,
  currency,
  amount,
  badge,
  progress,
  children,
}: {
  label: string
  client: { id: string; name: string }
  currency: string
  amount: string
  badge?: ReactNode
  /** Under the amount: how much of it is paid. */
  progress?: ReactNode
  /** HeroFact items. */
  children: ReactNode
}) {
  return (
    <section
      aria-label={translate('documentSummary')}
      className="grid gap-4 rounded-xl bg-card p-5 shadow-elevation-soft sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6"
    >
      <div className="grid min-w-0 content-start gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-caption text-muted-foreground">{label}</span>
            <RecordLink
              href={`/clients?id=${encodeURIComponent(client.id)}`}
              className="group flex min-w-0 items-center gap-2.5 rounded-md text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Initials name={client.name} className="size-8 text-caption" />
              <span className="truncate underline-offset-2 group-hover:underline">
                {client.name}
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </RecordLink>
          </div>
          {badge}
        </div>
        <p className="flex items-baseline gap-2 leading-none tabular-nums">
          <span className="text-body text-muted-foreground">{currency}</span>
          <span className="text-display font-normal tracking-[-0.025em]">{amount}</span>
        </p>
        {progress}
      </div>
      {/* Phones: one row under the amount. Wider: a column of its own beside it, so the facts balance the amount. */}
      <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-3 border-t border-border/60 pt-4 text-body-sm sm:min-w-36 sm:grid-cols-1 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
        {children}
      </dl>
    </section>
  )
}

/** One labelled fact under the amount: a date or a linked record, with an optional note under it. */
export function HeroFact({
  label,
  children,
  note,
  urgent = false,
}: {
  label: string
  children: ReactNode
  note?: ReactNode
  /** The note in red: overdue, expired. */
  urgent?: boolean
}) {
  return (
    <div className="grid content-start gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">
        {children}
        {note && (
          <span
            className={cn(
              'block text-caption',
              urgent ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  )
}

/** A linked record as a fact. */
export function HeroLink({ label, href, number }: { label: string; href: string; number: string }) {
  return (
    <HeroFact label={label}>
      <RecordLink href={href} className="font-code underline underline-offset-2 hover:no-underline">
        {number}
      </RecordLink>
    </HeroFact>
  )
}
