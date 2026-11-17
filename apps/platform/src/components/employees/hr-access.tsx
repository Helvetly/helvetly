'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Banknote, IdCard } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import {
  FeatureLockNotice,
  useFeatureLock,
  type FeatureLock,
} from '@/components/billing/feature-lock'
import { translate } from '@/lib/i18n'
import { can, useScopes } from '@/lib/permissions'
import { useSession } from '@/lib/queries'

/**
 * What the signed-in person may do in the Employees module, plan included. Without the plan's `employees` feature
 * the API refuses everything but an owner's reads: others see the lock instead of data (`blocked`), an owner keeps
 * reading and exporting, and every write is off with `lockReason` as its tooltip.
 */
export function hrAccess(scopes: readonly string[], role: string | undefined, lock: FeatureLock) {
  const owner = role === 'owner'
  const lockReason = lock ? translate('employeePlanReadOnlyTip') : null
  const writable = !lock
  return {
    owner,
    lock,
    lockReason,
    /** Not on the plan and not an owner: the API refuses every route. */
    blocked: Boolean(lock) && !owner,
    readEmployees: can(scopes, 'read:employees'),
    writeEmployees: writable && can(scopes, 'write:employees'),
    readPayroll: can(scopes, 'read:payroll'),
    writePayroll: writable && can(scopes, 'write:payroll'),
    /** Payroll edit may reveal sealed fields; a read, so an owner keeps it after a downgrade. */
    reveal: can(scopes, 'write:payroll'),
    /** May see that a write exists, enabled or (on a lapsed plan) disabled with `lockReason`. */
    seesEmployeeWrites: can(scopes, 'write:employees'),
    seesPayrollWrites: can(scopes, 'write:payroll'),
  }
}

export type HrAccess = ReturnType<typeof hrAccess>

export function useHrAccess(): HrAccess {
  return hrAccess(useScopes(), useSession().data?.role, useFeatureLock('employees'))
}

/** A disabled control keeps its tooltip: the span takes the hover and focus the disabled button cannot. */
export function DisabledTip({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={reason === null ? undefined : 0} className="inline-flex rounded-md">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{reason}</TooltipContent>
    </Tooltip>
  )
}

/** The plan lock, high under the tabs: what stays (the owner's view and export) and the way to the plans. */
export function HrLockNotice({ hr }: { hr: HrAccess }) {
  if (!hr.lock) return null
  return (
    <FeatureLockNotice
      lock={hr.lock}
      kept={hr.owner ? translate('employeePlanKeptOwner') : translate('employeePlanKeptMember')}
      className="mx-3 mt-3 md:mx-5"
    />
  )
}

/** The module's two screens as the header's tabs, each where the person may read it. */
export function useHrTabs(current: 'employees' | 'payroll') {
  const router = useRouter()
  const hr = useHrAccess()
  const items = [
    {
      id: 'employees',
      label: translate('employees'),
      icon: IdCard,
      href: '/employees',
      show: hr.readEmployees || hr.readPayroll,
    },
    {
      id: 'payroll',
      label: translate('payrollTab'),
      icon: Banknote,
      href: '/employees/payroll',
      show: hr.readPayroll,
    },
  ].filter((item) => item.show || item.id === current)
  return {
    tabs: items.map((item) => item.label),
    tabIcons: items.map((item) => item.icon),
    active: items.findIndex((item) => item.id === current),
    onSelect: (index: number) => {
      const item = items[index]
      if (item && item.id !== current) router.push(item.href)
    },
    savedViews: false,
  }
}
