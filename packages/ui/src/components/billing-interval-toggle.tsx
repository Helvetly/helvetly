'use client'

import { useTranslate } from '@helvetly/ui/components/language-provider'
import { cn } from '@helvetly/ui/lib/utils'
import { type ReactNode, useId } from 'react'

export type BillingInterval = 'month' | 'year'

const INTERVALS: BillingInterval[] = ['month', 'year']

/**
 * Monthly or yearly billing: a centred pill with a brand-coloured sliding thumb (native radios: arrow keys move and
 * choose), the yearly discount as a small pill inside "Yearly", and, while yearly is chosen, what it saves under it.
 */
export function BillingIntervalToggle({
  value,
  onValueChange,
  discount,
  saving,
  className,
}: {
  value: BillingInterval
  onValueChange: (value: BillingInterval) => void
  /** The yearly discount in percent, shown inside "Yearly"; none: no pill. */
  discount?: number
  /** What paying yearly saves, e.g. "Save CHF 45 a year on Basic", under the toggle while yearly is chosen. */
  saving?: ReactNode
  className?: string
}) {
  const translate = useTranslate()
  // One radio group per toggle; native radios move and choose with the arrow keys.
  const name = useId()
  const discountId = useId()
  const label: Record<BillingInterval, string> = {
    month: translate('billingMonthly'),
    year: translate('billingYearly'),
  }
  const yearly = value === 'year'

  return (
    <div className={cn('flex flex-col items-center gap-2', className)} data-slot="billing-interval">
      {/* A div, not a fieldset: a fieldset's anonymous content box shifts the absolutely placed thumb. */}
      <div
        role="radiogroup"
        aria-label={translate('billingInterval')}
        className="relative grid h-12 grid-cols-2 rounded-full border border-brand-solid/25 bg-card p-1 dark:border-brand-solid/40"
      >
        {/* The thumb: half the track, slid under the chosen option. */}
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-primary transition-transform duration-300 ease-out motion-reduce:transition-none',
            yearly && 'translate-x-full',
          )}
        />
        {INTERVALS.map((interval) => {
          const checked = interval === value
          const withDiscount = interval === 'year' && discount !== undefined
          return (
            <label
              key={interval}
              className={cn(
                'relative z-10 inline-flex min-w-28 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors duration-300 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring motion-reduce:transition-none',
                checked ? 'text-primary-foreground' : 'text-brand hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name={name}
                value={interval}
                checked={checked}
                onChange={() => onValueChange(interval)}
                aria-label={label[interval]}
                aria-describedby={withDiscount ? discountId : undefined}
                className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0 outline-none"
              />
              {label[interval]}
              {withDiscount && (
                <span
                  id={discountId}
                  data-slot="billing-discount"
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none',
                    checked ? 'bg-white text-primary' : 'bg-success-surface text-success',
                  )}
                >
                  {translate('billingYearlyDiscount', { percent: discount })}
                </span>
              )}
            </label>
          )
        })}
      </div>
      {saving && (
        // Its line is kept while monthly is chosen, so switching never moves the cards below.
        <p
          data-slot="billing-saving"
          aria-hidden={!yearly}
          className={cn('text-body-sm text-muted-foreground', !yearly && 'invisible')}
        >
          {saving}
        </p>
      )}
    </div>
  )
}
