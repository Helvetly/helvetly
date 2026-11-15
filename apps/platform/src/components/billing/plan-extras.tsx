import { cn } from '@helvetly/ui/lib/utils'
import { Check, InfinityIcon, Minus } from 'lucide-react'

import {
  FEATURE_LABELS,
  formatLimit,
  LIMIT_LABELS,
  type Billing,
  type FeatureKey,
  type Plan,
} from '@/lib/billing'

import { LIMIT_ORDER } from './plan-cards'

/** Every limit of every plan side by side, read from the plans. */
export function PlanComparison({ plans, current }: { plans: Plan[]; current: Billing['plan'] }) {
  const keys = LIMIT_ORDER.filter((key) => plans.some((plan) => key in plan.limits))
  const features = [...new Set(plans.flatMap((plan) => plan.features))]
  return (
    <section aria-labelledby="compare" className="mt-20 w-full max-w-[1080px]">
      <h2 id="compare" className="text-center text-page font-semibold tracking-[-0.02em]">
        Compare plans
      </h2>
      {/* Four columns fit a phone when their text wraps, so nothing scrolls sideways. */}
      <div className="mt-8 overflow-hidden rounded-2xl bg-card shadow-elevation-1">
        <table className="w-full table-fixed text-caption sm:text-body-sm">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.08]">
              <th
                scope="col"
                className="px-3 py-4 text-left font-medium text-muted-foreground sm:px-5"
              >
                <span className="sr-only">Limit</span>
              </th>
              {plans.map((plan) => (
                <th
                  key={plan.id}
                  scope="col"
                  className={cn(
                    'px-1.5 py-4 text-center font-semibold sm:px-4',
                    plan.id === current && 'bg-brand-surface/40',
                  )}
                >
                  {plan.name}
                  {plan.id === current && (
                    <span className="mx-auto mt-1 block w-fit rounded-full bg-brand-surface px-2 text-caption leading-5 font-medium text-brand sm:mt-0 sm:ml-1.5 sm:inline">
                      Current
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {keys.map((key) => (
              <tr key={key}>
                <th
                  scope="row"
                  className="px-3 py-3.5 text-left font-normal text-muted-foreground sm:px-5"
                >
                  {LIMIT_LABELS[key].replace(/ this month$/, ' a month')}
                </th>
                {plans.map((plan) => {
                  const value = plan.limits[key]
                  return (
                    <td
                      key={plan.id}
                      className={cn(
                        'px-1.5 py-3.5 text-center tabular-nums sm:px-4',
                        plan.id === current && 'bg-brand-surface/40',
                      )}
                    >
                      {value === null && key === 'members' ? (
                        <span className="font-medium text-brand">Any number</span>
                      ) : value === null ? (
                        <span className="inline-flex items-center gap-1 font-medium text-brand">
                          <InfinityIcon className="size-4" aria-hidden />
                          {/* A phone's column has room for the sign only. */}
                          <span className="max-sm:sr-only">Unlimited</span>
                        </span>
                      ) : value === 0 ? (
                        <Minus
                          className="mx-auto size-4 text-muted-foreground"
                          aria-label="Not included"
                        />
                      ) : (
                        formatLimit(key, value)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {features.map((feature) => (
              <FeatureRow key={feature} feature={feature} plans={plans} current={current} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FeatureRow({
  feature,
  plans,
  current,
}: {
  feature: FeatureKey
  plans: Plan[]
  current: Billing['plan']
}) {
  return (
    <tr>
      <th scope="row" className="px-3 py-3.5 text-left font-normal text-muted-foreground sm:px-5">
        {FEATURE_LABELS[feature]}
      </th>
      {plans.map((plan) => (
        <td
          key={plan.id}
          className={cn(
            'px-1.5 py-3.5 text-center sm:px-4',
            plan.id === current && 'bg-brand-surface/40',
          )}
        >
          {plan.features.includes(feature) ? (
            <Check className="mx-auto size-4 text-brand" aria-label="Included" />
          ) : (
            <Minus className="mx-auto size-4 text-muted-foreground" aria-label="Not included" />
          )}
        </td>
      ))}
    </tr>
  )
}
