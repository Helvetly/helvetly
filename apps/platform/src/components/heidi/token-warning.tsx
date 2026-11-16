'use client'
import Link from 'next/link'

import type { HeidiUsage } from '@/lib/heidi'
import { translate } from '@/lib/i18n'

/** From this share of the month's allowance on, the composer warns that answers will stop. */
export const WARN_AT = 75

/** Whole percent of this month's AI tokens used, or null when there is no capped, known model usage. */
export function tokenShare(usage: HeidiUsage | undefined): number | null {
  if (!usage || usage.mode === 'local' || usage.usage_uncertain || usage.tokens_included === null)
    return null
  const allowance = usage.tokens_included + usage.tokens_purchased
  if (allowance <= 0) return null
  return Math.floor((usage.tokens_used / allowance) * 100)
}

/** True once the share reaches the warning threshold. */
export const shouldWarn = (share: number | null): share is number =>
  share !== null && share >= WARN_AT

/** Sits on top of the composer, sharing its width; the composer drops its top corners to join it. */
export function TokenWarning({ share }: { share: number }) {
  return (
    <p className="rounded-t-2xl border border-b-0 border-warning-border bg-warning-surface px-3 py-2 text-caption text-pretty text-warning">
      {translate('youHaveUsedOfThisMonthSAITokens', { share: Math.min(share, 100) })}{' '}
      <Link href="/settings/billing/plans" className="font-medium underline underline-offset-2">
        {translate('seePlans')}
      </Link>
    </p>
  )
}
