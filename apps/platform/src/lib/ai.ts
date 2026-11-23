'use client'
import { useQuery } from '@tanstack/react-query'

import { api, type AuthConfig } from '@/lib/api'
import {
  billingKeys,
  fetchBilling,
  isUpgrade,
  usageItems,
  type Billing,
  type PlanId,
  type UsageItem,
} from '@/lib/billing'
import { heidiApi, usageKey, type HeidiUsage } from '@/lib/heidi'
import { queryKeys } from '@/lib/queries'

/** Heidi's chat, or the automation pool of AI import, filing and contracts. */
export type AIPool = 'heidi' | 'automation'

export type AIState = {
  /** The installation has an AI model: false hides every AI option. */
  available: boolean
  /** The person approved AI use in this workspace (asked on first use when not). */
  consented: boolean
  /** Tokens left in the pool this month; null = no cap known. */
  poolLeft: number | null
  /** The pool is used up this month: AI options stay visible but disabled. */
  usedUp: boolean
}

const POOL_LIMIT: Record<AIPool, 'ai_tokens_per_month' | 'ai_automation_tokens_per_month'> = {
  heidi: 'ai_tokens_per_month',
  automation: 'ai_automation_tokens_per_month',
}

/** The AI state from the installation's config, the person's approval and the plan's usage. */
export function aiState(
  config: AuthConfig | undefined,
  usage: HeidiUsage | undefined,
  items: UsageItem[] | undefined,
  pool: AIPool,
): AIState {
  // Unknown until the config loads (or from an older API): shown, the server still refuses.
  const available = config?.ai_available !== false
  const item = items?.find((entry) => entry.limit === POOL_LIMIT[pool])
  const poolLeft =
    item && item.max !== null && item.used !== null ? Math.max(0, item.max - item.used) : null
  return {
    available,
    consented: usage?.consent?.granted === true,
    poolLeft,
    usedUp: available && poolLeft === 0,
  }
}

/**
 * The one source of whether and how AI options show; every AI entry point asks it. It reads what the app loads at
 * start (the installation's config through <Analytics> in the providers, the plan's usage through the shell) and the
 * approval once asked, so an entry point adds no requests of its own; what is not known yet shows AI, and the server
 * still refuses it.
 */
export function useAI(pool: AIPool = 'automation'): AIState {
  const config = useQuery({
    queryKey: queryKeys.authConfig,
    queryFn: api.authConfig,
    staleTime: Infinity,
    enabled: false,
  }).data
  const usage = useQuery({ queryKey: usageKey, queryFn: heidiApi.usage, enabled: false })
  const billing = useQuery({
    queryKey: billingKeys.overview,
    queryFn: fetchBilling,
    enabled: false,
  })
  return aiState(config, usage.data, billing.data && usageItems(billing.data), pool)
}

/** The next plan up with more of the pool's tokens (null = no cap counts as more), or null when none has more. */
export function planWithMoreAI(billing: Billing, pool: AIPool): PlanId | null {
  const key = POOL_LIMIT[pool]
  const now = billing.plans.find((plan) => plan.id === billing.plan)?.limits[key] ?? 0
  const more = billing.plans
    .filter((plan) => isUpgrade(billing.plan, plan.id))
    .filter((plan) => {
      const max = plan.limits[key]
      return max === null || (now !== null && max > now)
    })
    .toSorted((a, b) => (isUpgrade(a.id, b.id) ? -1 : 1))
  return more[0]?.id ?? null
}
