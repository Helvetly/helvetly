import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { planRequired } from '@/lib/billing'

/** A toast for a change refused because the workspace has no plan; reports whether it was one. */
export function toastPlanRequired(error: unknown, seePlans: () => void): boolean {
  if (!planRequired(error)) return false
  // One toast, however many requests were refused at once.
  toast.error(errorMessage(error), {
    id: 'plan-required',
    action: { label: 'See plans', onClick: seePlans },
  })
  return true
}
