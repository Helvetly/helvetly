import { toast } from 'sonner'

import { planRefusal } from '@/lib/billing'
import { translate } from '@/lib/i18n'

const PLAN_NAMES = { basic: 'Basic', pro: 'Pro', business: 'Business' } as const

/**
 * A toast for a change the plan refuses: no plan (402 `plan_required`) or a feature the plan lacks (403
 * `feature_not_in_plan`, or an earlier 402 naming the feature); reports whether it was one. The API's message says
 * what was refused; the action leads to the plans.
 */
export function toastPlanRequired(error: unknown, seePlans: () => void): boolean {
  const refusal = planRefusal(error)
  if (!refusal) return false
  // One toast per refused feature, however many requests were refused at once.
  toast.error(refusal.message, {
    id: refusal.feature ? `plan-required-${refusal.feature}` : 'plan-required',
    action: {
      label: refusal.requiredPlan
        ? translate('see2', { name: PLAN_NAMES[refusal.requiredPlan] })
        : translate('seePlans'),
      onClick: seePlans,
    },
  })
  return true
}
