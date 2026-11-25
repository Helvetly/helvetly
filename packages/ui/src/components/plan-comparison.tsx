'use client'

import { HelpPopover } from '@helvetly/ui/components/help-popover'
import { useTranslate } from '@helvetly/ui/components/language-provider'
import type {
  ComparisonCell,
  ComparisonGroup,
  ComparisonRow,
  PlanId,
} from '@helvetly/ui/lib/plan-features'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

export type ComparisonPlan = {
  id: PlanId
  name: string
  /** Under the name in the pinned head: the price and the call to action. */
  head: ReactNode
}

function Cell({ cell }: { cell: ComparisonCell }) {
  const translate = useTranslate()
  if (cell.kind === 'no')
    return (
      <span className="inline-flex text-muted-foreground/60">
        <Minus aria-hidden className="size-4" />
        <span className="sr-only">{translate('planNotIncluded')}</span>
      </span>
    )
  if (cell.kind === 'yes')
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-success-surface text-success">
        <Check aria-hidden className="size-3.5" />
        <span className="sr-only">{translate('planIncluded')}</span>
      </span>
    )
  return (
    <span className="tabular-nums">
      <strong className="font-semibold">{cell.amount}</strong>
      {cell.unit && (
        <>
          {' '}
          <span className="whitespace-nowrap text-muted-foreground">{cell.unit}</span>
        </>
      )}
    </span>
  )
}

function RowLabel({ row }: { row: ComparisonRow }) {
  const translate = useTranslate()
  return (
    <span className="inline-flex items-start gap-1.5">
      <span>{row.label}</span>
      {row.hint && (
        <span className="mt-0.5 inline-flex">
          <HelpPopover label={translate('planAbout', { feature: row.label })} title={row.label}>
            <p className="text-muted-foreground">{row.hint}</p>
          </HelpPopover>
        </span>
      )}
    </span>
  )
}

/**
 * Every feature and allowance side by side, grouped as the cards are, with the plans' names, prices and calls to
 * action pinned while it scrolls. Narrow screens get one section per plan instead, so nothing scrolls sideways.
 */
export function PlanComparison({
  groups,
  plans,
  featured,
  stickyTop = 'top-0',
  surface = 'bg-background',
}: {
  groups: ComparisonGroup[]
  plans: ComparisonPlan[]
  /** The recommended plan's column is tinted. */
  featured?: PlanId
  /** Where the pinned head stops, below a fixed site header (a `top-*` class). */
  stickyTop?: string
  /** The pinned head's fill: the page's own background, so the head never shows as a band (a `bg-*` class). */
  surface?: string
}) {
  const translate = useTranslate()
  const band = (plan: PlanId) => plan === featured && 'bg-violet-surface/40'
  return (
    <div data-slot="plan-comparison">
      <table className="hidden w-full table-fixed border-separate border-spacing-0 text-left text-body lg:table">
        <caption className="sr-only">{translate('planCompareTitle')}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className={cn(
                'sticky z-10 w-[28%] border-b px-3 pb-4 text-left align-bottom text-title font-semibold',
                surface,
                stickyTop,
              )}
            >
              {translate('planFeatureColumn')}
            </th>
            {plans.map((plan) => (
              <th
                key={plan.id}
                scope="col"
                className={cn(
                  'sticky z-10 border-b px-4 pt-4 pb-4 align-top font-normal',
                  surface,
                  stickyTop,
                  plan.id === featured && 'rounded-t-2xl bg-violet-surface',
                )}
              >
                <span className="block text-title-sm font-semibold">{plan.name}</span>
                {plan.head}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.group}>
            <tr>
              <th
                scope="colgroup"
                colSpan={plans.length + 1}
                className="px-3 pt-8 pb-2 text-body-sm font-semibold"
              >
                {group.title}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  aria-label={row.label}
                  className="border-t px-3 py-3 align-top font-normal"
                >
                  <RowLabel row={row} />
                </th>
                {plans.map((plan) => (
                  <td key={plan.id} className={cn('border-t px-4 py-3 align-top', band(plan.id))}>
                    <Cell cell={row.cells[plan.id]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <div className="grid gap-4 lg:hidden">
        {plans.map((plan) => (
          <section
            key={plan.id}
            aria-label={plan.name}
            className={cn(
              'rounded-3xl border bg-card p-5',
              plan.id === featured && 'border-violet-solid/35',
            )}
          >
            <h3 className="text-title-sm font-semibold">{plan.name}</h3>
            {plan.head}
            {groups.map((group) => (
              <div key={group.group}>
                <h4 className="mt-6 text-body-sm font-semibold">{group.title}</h4>
                <dl className="mt-2 grid gap-2">
                  {group.rows.map((row) => (
                    <div key={row.key} className="flex items-start justify-between gap-4">
                      <dt
                        className={cn(
                          'text-body-sm',
                          row.cells[plan.id].kind === 'no' && 'text-muted-foreground',
                        )}
                      >
                        <RowLabel row={row} />
                      </dt>
                      <dd className="max-w-[50%] shrink-0 text-right text-body-sm">
                        <Cell cell={row.cells[plan.id]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
