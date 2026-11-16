import { HelpTip } from '@helvetly/ui/components/form-field'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, InfinityIcon, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  formatLimit,
  formatTokens,
  usageHint,
  usageLabel,
  type Billing,
  type PlanId,
  type PublicOffer,
} from '@/lib/billing'
import { translate } from '@/lib/i18n'

const PLAN_NAMES: Record<PlanId, string> = { basic: 'Basic', pro: 'Pro', business: 'Business' }
const PLANS: PlanId[] = ['basic', 'pro', 'business']

/** One allowance for one person on a plan: "150", "5 GB", "5M"; null when the plan does not include it. */
function allowance(offer: PublicOffer, key: string, plan: PlanId): string | null {
  const limit = offer.limits[key]
  const value = limit?.plans[plan]
  if (!limit || !value?.included || value.value === 0) return null
  if (value.value === null) return translate('unlimited2')
  return limit.unit === 'token' ? formatTokens(value.value) : formatLimit(key, value.value)
}

/** How an allowance is counted: "/ team member / month", "/ workspace". */
function per(offer: PublicOffer, key: string): string {
  const limit = offer.limits[key]
  if (!limit) return ''
  return translate('allowancePer', {
    scope: limit.per_person ? 'person' : 'workspace',
    monthly: String(limit.period !== null),
  })
}

const NotIncluded = () => (
  <span className="inline-flex items-center gap-1 text-muted-foreground">
    <Minus className="size-4 shrink-0" aria-hidden />
    <span className="max-sm:sr-only">{translate('notIncluded')}</span>
  </span>
)

/**
 * The business comparison and the allowances of the offer on sale, the same rows as the public pricing page: what
 * each plan includes, and what each paid person adds or the workspace gets.
 */
export function PlanComparison({
  offer,
  current,
}: {
  offer: PublicOffer
  current: Billing['plan']
}) {
  const cell = (plan: PlanId, content: ReactNode) => (
    <td
      key={plan}
      data-plan={plan}
      className={cn(
        'px-1.5 py-3.5 text-center tabular-nums sm:px-4',
        plan === current && 'bg-brand-surface/40',
      )}
    >
      {content ?? <NotIncluded />}
    </td>
  )
  return (
    <section aria-labelledby="compare" className="mt-20 w-full max-w-[1080px]">
      <h2 id="compare" className="text-center text-page font-semibold tracking-[-0.02em]">
        {translate('comparePlans')}
      </h2>
      {/* Four columns fit a phone when their text wraps, so nothing scrolls sideways. */}
      <div className="mt-8 overflow-hidden rounded-2xl bg-card shadow-elevation-1">
        <table className="w-full table-fixed text-caption sm:text-body-sm">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.08]">
              <th scope="col" className="px-3 py-4 text-left sm:px-5">
                <span className="sr-only">{translate('whatYouGet')}</span>
              </th>
              {PLANS.map((plan) => (
                <th
                  key={plan}
                  scope="col"
                  className={cn(
                    'px-1.5 py-4 text-center font-semibold sm:px-4',
                    plan === current && 'bg-brand-surface/40',
                  )}
                >
                  {PLAN_NAMES[plan]}
                  {plan === current && (
                    <span className="mx-auto mt-1 block w-fit rounded-full bg-brand-surface px-2 text-caption leading-5 font-medium text-brand sm:mt-0 sm:ml-1.5 sm:inline">
                      {translate('current')}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {offer.comparison.map((row) => (
              <tr key={row.key} data-row={row.key}>
                <th
                  scope="row"
                  className="px-3 py-3.5 text-left font-normal text-muted-foreground sm:px-5"
                >
                  {row.label}
                  {row.note && (
                    <span className="mt-0.5 block text-caption text-pretty max-sm:hidden">
                      {row.note}
                    </span>
                  )}
                </th>
                {PLANS.map((plan) => {
                  if (!row.plans[plan]) return cell(plan, null)
                  const key = row.limit_keys[0] ?? ''
                  const value = allowance(offer, key, plan)
                  return cell(
                    plan,
                    value ? (
                      <span className="font-medium">
                        {value}
                        {value !== translate('unlimited2') && (
                          <span className="font-normal text-muted-foreground">
                            {per(offer, key)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <Check
                        className="mx-auto size-4 text-brand"
                        aria-label={translate('included')}
                      />
                    ),
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            <tr className="border-t border-black/[0.06] dark:border-white/[0.08]">
              <th
                scope="colgroup"
                colSpan={4}
                className="px-3 pt-6 pb-2 text-left font-semibold sm:px-5"
              >
                {translate('allowances')}
                <span className="mt-0.5 block text-caption font-normal text-pretty text-muted-foreground">
                  {translate('eachPaidPersonAddsThePerPersonAmounts')}
                </span>
              </th>
            </tr>
            {offer.usage_details.map((key) => {
              const label = usageLabel(key).replace(/ this month$/, '')
              const hint = usageHint(key)
              return (
                <tr key={key} data-row={key}>
                  <th
                    scope="row"
                    className="px-3 py-3.5 text-left font-normal text-muted-foreground sm:px-5"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {label}
                      {hint && <HelpTip label={label}>{hint}</HelpTip>}
                    </span>
                    <span className="mt-0.5 block text-caption">
                      {translate('allowanceScope', {
                        scope: offer.limits[key]?.per_person ? 'person' : 'workspace',
                        monthly: String(Boolean(offer.limits[key]?.period)),
                      })}
                    </span>
                  </th>
                  {PLANS.map((plan) => {
                    const value = allowance(offer, key, plan)
                    return cell(
                      plan,
                      value === translate('unlimited2') ? (
                        <span className="inline-flex items-center gap-1 font-medium text-brand">
                          <InfinityIcon className="size-4" aria-hidden />
                          <span className="max-sm:sr-only">{translate('unlimited2')}</span>
                        </span>
                      ) : (
                        value
                      ),
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
