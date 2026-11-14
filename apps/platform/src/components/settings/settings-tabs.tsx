'use client'

import {
  BookOpen,
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

import { useLeaveGuard } from '@/components/section-form'
import { PageHeader } from '@/components/shell/page-header'
import { useSession } from '@/lib/queries'

type Page = { label: string; href: string; icon: LucideIcon; managers?: true }

/** The workspace first, then your own settings (the same in every workspace), then the rest of the workspace's. */
export const SETTINGS_PAGES: Page[] = [
  { label: 'Workspace', href: '/settings/workspace', icon: Building2 },
  { label: 'Account', href: '/account', icon: UserRound },
  { label: 'API & MCP', href: '/settings/api', icon: PlugZap },
  { label: 'Billing', href: '/settings/billing', icon: CreditCard },
  { label: 'Invoices', href: '/settings/invoices', icon: ReceiptText },
  { label: 'VAT return', href: '/settings/vat-return', icon: Landmark },
  { label: 'Ledger', href: '/settings/ledger', icon: BookOpen, managers: true },
  // The books in the order of a month-end: record, declare, post, close, audit.
  { label: 'Closing', href: '/settings/periods', icon: CalendarCheck },
  { label: 'Audit log', href: '/settings/audit-log', icon: ScrollText, managers: true },
]

export const isManager = (role: string | undefined) => role === 'owner' || role === 'admin'

/** The settings page at this path: an exact match, else the closest parent (billing's plans). */
export function settingsPageAt(pathname: string): Page | undefined {
  const path = pathname.replace(/\/$/, '') || '/'
  return (
    SETTINGS_PAGES.find((page) => page.href === path) ??
    SETTINGS_PAGES.filter((page) => path.startsWith(`${page.href}/`)).at(-1)
  )
}

/**
 * The top bar of a settings page: the settings pages as tabs (those that don't fit under "More") and the
 * page's own actions. Moving to another tab asks first when a section has unsaved changes.
 */
export function SettingsHeader({ actions }: { actions?: ReactNode }) {
  const router = useRouter()
  const guard = useLeaveGuard()
  const manager = isManager(useSession().data?.role)
  const pages = SETTINGS_PAGES.filter((page) => manager || !page.managers)
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
