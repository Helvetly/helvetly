'use client'
import { PlanBadge } from '@helvetly/ui/components/plan-badge'
import { BadgeCheck } from 'lucide-react'
import Link from 'next/link'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { DOC_TYPES, useApprovalSettings, type ApprovalPolicy } from '@/lib/approvals'
import { translate } from '@/lib/i18n'
import { formatMoney } from '@/lib/invoices'
import { useSession } from '@/lib/queries'

import { DOC_TYPE_INFO } from './approvals-settings'
import { SettingsRow } from './layout'
import { isManager } from './settings-tabs'

/** The policies in one line: "Off", or "On: Invoices from CHF 5'000, Credit notes". */
export function approvalsSummary(policies: ApprovalPolicy[], currency: string): string {
  const on = DOC_TYPES.flatMap((type) => {
    const policy = policies.find((p) => p.doc_type === type && p.enabled)
    if (!policy) return []
    const label = DOC_TYPE_INFO[type].label
    return policy.min_total
      ? translate('approvalsRowFrom', {
          type: label,
          amount: formatMoney(policy.min_total, currency),
        })
      : label
  })
  return on.length ? translate('approvalsRowOn', { types: on.join(', ') }) : translate('off')
}

const link = 'text-sm underline underline-offset-4'

/** Settings → Invoices: where approvals stand, with the way to the Approvals tab. Owners and admins only. */
export function ApprovalsRow({ currency }: { currency: string }) {
  const manager = isManager(useSession().data?.role)
  const lock = useFeatureLock('document_approvals')
  if (!manager) return null
  return (
    <ul aria-label={translate('approvalsRowTitle')}>
      <SettingsRow
        icon={<BadgeCheck />}
        title={translate('approvalsRowTitle')}
        meta={
          lock ? (
            <PlanBadge plan={lock.plan?.id ?? 'business'}>
              {translate('includedInPlan', { plan: lock.plan?.name ?? 'Business' })}
            </PlanBadge>
          ) : (
            <Summary currency={currency} />
          )
        }
      >
        <Link href="/settings/approvals" className={link}>
          {lock ? translate('approvalsRowSetUp') : <Action />}
        </Link>
      </SettingsRow>
    </ul>
  )
}

function usePolicies() {
  return useApprovalSettings().data?.policies
}

function Summary({ currency }: { currency: string }) {
  const policies = usePolicies()
  return policies ? approvalsSummary(policies, currency) : '…'
}

function Action() {
  const policies = usePolicies()
  return policies?.some((p) => p.enabled) ? translate('change') : translate('approvalsRowSetUp')
}
