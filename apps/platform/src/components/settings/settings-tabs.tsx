'use client'
import {
  BriefcaseBusiness,
  Building2,
  CreditCard,
  PlugZap,
  ReceiptText,
  ScrollText,
  Store,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { useEmployeesHidden } from '@/components/billing/feature-lock'
import { useLeaveGuard } from '@/components/section-form'
import { PageHeader } from '@/components/shell/page-header'
import { translate } from '@/lib/i18n'
import { canReadPath, useScopes } from '@/lib/permissions'

export type Page = { label: string; href: string; icon: LucideIcon }

/** The workspace and its company first, then your own settings (the same in every workspace), invoices, employment, then the rest of the workspace's. */
export const SETTINGS_PAGES: Page[] = [
  { label: translate('workspace'), href: '/settings/workspace', icon: Building2 },
  { label: translate('company'), href: '/settings/company', icon: Store },
  { label: translate('account'), href: '/account', icon: UserRound },
  { label: translate('invoices'), href: '/settings/invoices', icon: ReceiptText },
  { label: translate('employment'), href: '/settings/employment', icon: BriefcaseBusiness },
  { label: translate('apiMCP'), href: '/settings/api', icon: PlugZap },
  { label: translate('billing'), href: '/settings/billing', icon: CreditCard },
  { label: translate('auditLog'), href: '/settings/audit-log', icon: ScrollText },
]

export const isManager = (role: string | undefined) => role === 'owner' || role === 'admin'

/** Where "Settings" opens: the first settings page the person may read, the workspace's for an owner or admin. */
export function useSettingsHref() {
  const scopes = useScopes()
  return SETTINGS_PAGES.find((page) => canReadPath(scopes, page.href))?.href ?? '/account'
}

/** The page of these tabs at this path: an exact match, else the closest parent (billing's plans). */
export function settingsPageAt(pathname: string, pages = SETTINGS_PAGES): Page | undefined {
  const path = pathname.replace(/\/$/, '') || '/'
  return (
    pages.find((page) => page.href === path) ??
    pages.findLast((page) => path.startsWith(`${page.href}/`))
  )
}

/**
 * The top bar of a settings page: the settings pages as tabs (those that don't fit under "More") and the
 * page's own actions. Moving to another tab asks first when a section has unsaved changes.
 */
export function SettingsHeader({ actions }: { actions?: ReactNode }) {
  // Employment is not offered on a plan without employees (an owner with records still reaches it).
  const noEmployment = useEmployeesHidden()
  const pages = noEmployment
    ? SETTINGS_PAGES.filter((page) => page.href !== '/settings/employment')
    : SETTINGS_PAGES
  return <TabsHeader pages={pages} actions={actions} />
}

/** Pages shown as tabs of one area (settings, books); a page of an area the person cannot read is left out, as in the sidebar. */
export function TabsHeader({ pages, actions }: { pages: Page[]; actions?: ReactNode }) {
  const router = useRouter()
  const guard = useLeaveGuard()
  const scopes = useScopes()
  // Employment also opens with payroll view: see `canReadPath`.
  const readable = pages.filter((page) => canReadPath(scopes, page.href))
  const current = settingsPageAt(usePathname() ?? '', readable)
  return (
    <>
      {guard.dialog}
      <PageHeader
        tabs={readable.map((page) => page.label)}
        tabIcons={readable.map((page) => page.icon)}
        active={Math.max(
          0,
          readable.findIndex((page) => page === current),
        )}
        onSelect={(index) => {
          const page = readable[index]
          if (page && page !== current) guard.leave(() => router.push(page.href))
        }}
        savedViews={false}
        actions={actions ?? <span />}
      />
    </>
  )
}
