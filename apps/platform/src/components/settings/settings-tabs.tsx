'use client'
import {
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CreditCard,
  Landmark,
  PlugZap,
  ReceiptText,
  ScrollText,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { useEmployeesHidden } from '@/components/billing/feature-lock'
import { useLeaveGuard } from '@/components/section-form'
import { PageHeader } from '@/components/shell/page-header'
import { translate } from '@/lib/i18n'
import { useInvoiceSettings } from '@/lib/invoices'
import { canReadPath, useScopes } from '@/lib/permissions'

type Page = { label: string; href: string; icon: LucideIcon }

/** The workspace first, then your own settings (the same in every workspace), employment, then the rest of the workspace's. */
export const SETTINGS_PAGES: Page[] = [
  { label: translate('workspace'), href: '/settings/workspace', icon: Building2 },
  { label: translate('account'), href: '/account', icon: UserRound },
  { label: translate('employment'), href: '/settings/employment', icon: BriefcaseBusiness },
  { label: translate('apiMCP'), href: '/settings/api', icon: PlugZap },
  { label: translate('billing'), href: '/settings/billing', icon: CreditCard },
  { label: translate('invoices'), href: '/settings/invoices', icon: ReceiptText },
  { label: translate('vatReturn'), href: '/settings/vat-return', icon: Landmark },
  { label: translate('ledger'), href: '/settings/ledger', icon: BookOpen },
  // The books in the order of a month-end: record, declare, post, close, audit.
  { label: translate('closing'), href: '/settings/periods', icon: CalendarCheck },
  { label: translate('auditLog'), href: '/settings/audit-log', icon: ScrollText },
]

export const isManager = (role: string | undefined) => role === 'owner' || role === 'admin'

/** The settings page at this path: an exact match, else the closest parent (billing's plans). */
export function settingsPageAt(pathname: string): Page | undefined {
  const path = pathname.replace(/\/$/, '') || '/'
  return (
    SETTINGS_PAGES.find((page) => page.href === path) ??
    SETTINGS_PAGES.findLast((page) => path.startsWith(`${page.href}/`))
  )
}

/**
 * The top bar of a settings page: the settings pages as tabs (those that don't fit under "More") and the
 * page's own actions. Moving to another tab asks first when a section has unsaved changes.
 */
export function SettingsHeader({ actions }: { actions?: ReactNode }) {
  const router = useRouter()
  const guard = useLeaveGuard()
  const scopes = useScopes()
  // A page of an area the person cannot read is left out, as in the sidebar (employment also opens with payroll view).
  // A business not registered for VAT files no VAT return: the tab shows once the invoice settings say it is.
  const notVatRegistered = useInvoiceSettings().data?.vat_registered === false
  const noEmployment = useEmployeesHidden()
  const pages = SETTINGS_PAGES.filter(
    (page) =>
      canReadPath(scopes, page.href) &&
      !(notVatRegistered && page.href === '/settings/vat-return') &&
      !(noEmployment && page.href === '/settings/employment'),
  )
  const current = settingsPageAt(usePathname() ?? '')
  return (
    <>
      {guard.dialog}
      <PageHeader
        tabs={pages.map((page) => page.label)}
        tabIcons={pages.map((page) => page.icon)}
        active={Math.max(
          0,
          pages.findIndex((page) => page === current),
        )}
        onSelect={(index) => {
          const page = pages[index]
          if (page && page !== current) guard.leave(() => router.push(page.href))
        }}
        savedViews={false}
        actions={actions ?? <span />}
      />
    </>
  )
}
