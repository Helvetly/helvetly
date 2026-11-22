import { cn } from '@helvetly/ui/lib/utils'
import { Lock } from 'lucide-react'
import * as React from 'react'

export type PlanId = 'basic' | 'pro' | 'business'

/** Each plan paints with its own semantic tokens (`--plan-<id>`, `-surface`, `-border`) in both themes. */
const PLAN_VARS: Record<PlanId, string> = {
  basic:
    '[--plan-ink:var(--plan-basic)] [--plan-bg:var(--plan-basic-surface)] [--plan-line:var(--plan-basic-border)]',
  pro: '[--plan-ink:var(--plan-pro)] [--plan-bg:var(--plan-pro-surface)] [--plan-line:var(--plan-pro-border)]',
  business:
    '[--plan-ink:var(--plan-business)] [--plan-bg:var(--plan-business-surface)] [--plan-line:var(--plan-business-border)]',
}

const isPlan = (plan: string | undefined): plan is PlanId => plan !== undefined && plan in PLAN_VARS

/**
 * The one plan label: "Business", "🔒 Pro", "Included in Business". `locked` adds the lock; the icon is the
 * label's size and colour, kept even inside containers that size every svg (the sidebar). An unknown or missing plan is shown as Basic's neutral tone.
 */
function PlanBadge({
  plan,
  locked = false,
  className,
  children,
  ...props
}: React.ComponentProps<'span'> & { plan?: string; locked?: boolean }) {
  const id = isPlan(plan) ? plan : 'basic'
  return (
    <span
      data-slot="plan-badge"
      data-plan={id}
      className={cn(
        'inline-flex h-5 w-fit max-w-full shrink-0 items-center gap-1 rounded-md border border-(color:--plan-line) bg-(color:--plan-bg) px-1.5 text-caption font-medium whitespace-nowrap text-(color:--plan-ink) [&>svg]:size-3! [&>svg]:shrink-0 [&>svg]:text-current',
        PLAN_VARS[id],
        className,
      )}
      {...props}
    >
      {locked && <Lock aria-hidden strokeWidth={2} />}
      {children}
    </span>
  )
}

export { PlanBadge }
