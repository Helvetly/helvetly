'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { PLANS_HREF } from '@/components/billing/feature-lock'
import { isManager } from '@/components/settings/settings-tabs'
import { planWithMoreAI, type AIPool } from '@/lib/ai'
import { useBilling } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

/**
 * "AI budget used up this month · Buy more": the one message of every AI option whose pool is empty. AI token
 * packs are no longer sold, so "Buy more" opens the plans with the next plan that has more tokens chosen; only
 * owners and admins manage billing, everyone else is told whom to ask.
 */
export function AIBudgetUsedUp({ pool = 'automation' }: { pool?: AIPool }) {
  const manager = isManager(useSession().data?.role)
  const billing = useBilling().data
  const plan = billing ? planWithMoreAI(billing, pool) : null
  return (
    <span>
      {translate('aiBudgetUsedUp')}
      {' · '}
      {manager ? (
        <Link
          href={plan ? `${PLANS_HREF}?plan=${plan}` : PLANS_HREF}
          className="underline underline-offset-2"
        >
          {translate('buyMore')}
        </Link>
      ) : (
        translate('askAnOwnerForMoreAIBudget')
      )}
    </span>
  )
}

/** A disabled AI button saying why on hover and focus while its pool is used up; the button as it is otherwise. */
export function AIBudgetTip({
  usedUp,
  pool = 'automation',
  children,
}: {
  usedUp: boolean
  pool?: AIPool
  children: ReactNode
}) {
  // Focusable only while disabled, so the reason also shows to the keyboard (as DisabledTip does).
  const focus = usedUp ? 0 : undefined
  if (!usedUp) return children
  return (
    <Tooltip>
      {/* A disabled button gets no pointer events: the wrapper takes the hover. */}
      <TooltipTrigger asChild>
        <span tabIndex={focus} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <AIBudgetUsedUp pool={pool} />
      </TooltipContent>
    </Tooltip>
  )
}
