import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { featureNotInPlan, planRequired } from '@/lib/billing'
import { translate } from '@/lib/i18n'

/**
 * A toast for a change refused by the plan: the workspace has none, or its plan lacks the module. Reports whether it
 * was one.
 */
export function toastPlanRequired(error: unknown, seePlans: () => void): boolean {
  if (!planRequired(error) && !featureNotInPlan(error)) return false
  // One toast per refusal, however many requests were refused at once.
  toast.error(errorMessage(error), {
    id: planRequired(error) ? 'plan-required' : `feature-not-in-plan-${errorMessage(error)}`,
    action: { label: translate('seePlans'), onClick: seePlans },
  })
  return true
}
