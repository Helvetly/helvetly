'use client'

import { useTranslate } from '@helvetly/ui/components/language-provider'
import { cn } from '@helvetly/ui/lib/utils'
import { type ReactNode, useId } from 'react'

export type BillingInterval = 'month' | 'year'

const INTERVALS: BillingInterval[] = ['month', 'year']

/**
 * Monthly or yearly billing: a pill with a sliding thumb (native radios: arrow keys move and choose) and, beside it,
 * what yearly saves as a soft callout with a drawn arrow pointing at "Yearly" (below the pill on phones).
 */
export function BillingIntervalToggle({
  value,
  onValueChange,
  saving,
  className,
}: {
  value: BillingInterval
  onValueChange: (value: BillingInterval) => void
  /** What paying yearly saves, e.g. "Save 20% — CHF 45 a year on Basic"; none: no callout. */
  saving?: ReactNode
  className?: string
}) {
  const translate = useTranslate()
  // One radio group per toggle; native radios move and choose with the arrow keys.
  const name = useId()
  const label: Record<BillingInterval, string> = {
    month: translate('billingMonthly'),
    year: translate('billingYearly'),
  }

  return (
    <div
      className={cn('flex flex-col items-center gap-3 sm:flex-row sm:gap-0', className)}
      data-slot="billing-interval"
    >
      <fieldset className="relative grid h-11 grid-cols-2 rounded-full bg-muted p-1 ring-1 ring-input ring-inset">
        <legend className="sr-only">{translate('billingInterval')}</legend>
        {/* The thumb: half the track, slid under the chosen option. */}
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-transform duration-300 ease-out motion-reduce:transition-none dark:border-white/8 dark:bg-white/10',
            value === 'year' && 'translate-x-full',
          )}
        />
        {INTERVALS.map((interval) => (
          <label
            key={interval}
            className={cn(
              'relative z-10 inline-flex min-w-28 cursor-pointer items-center justify-center rounded-full px-5 text-sm font-medium transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50',
              interval === value
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <input
              type="radio"
              name={name}
              value={interval}
              checked={interval === value}
              onChange={() => onValueChange(interval)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0 outline-none"
            />
            {label[interval]}
          </label>
        ))}
      </fieldset>
      {saving && (
        <p
          data-slot="billing-saving"
          className="flex items-center gap-1 text-body-sm font-medium text-success sm:ml-2"
        >
          {/* A drawn arrow from the callout back to "Yearly", on wide screens where they sit side by side. */}
          <svg
            aria-hidden
            viewBox="0 0 40 24"
            fill="none"
            className="hidden h-6 w-10 shrink-0 text-success-solid sm:block"
          >
            <path
              d="M38 18c-9 3-20 1-27-6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M9 5l1.5 7.5L17 10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="rounded-full bg-success-surface px-3 py-1">{saving}</span>
        </p>
      )}
    </div>
  )
}
