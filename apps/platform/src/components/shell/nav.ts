import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import {
  Banknote,
  Bell,
  Building2,
  ClipboardCheck,
  FileText,
  FileUp,
  IdCard,
  LayoutGrid,
  Package,
  ReceiptText,
  ScrollText,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { can, resourceForPath, type Need } from '@/lib/permissions'

export type NavItem = {
  label: string
  icon: ComponentType<{ className?: string }>
  href?: string
  isNew?: boolean
  /** Opens Heidi's panel instead of a page. */
  heidi?: boolean
  /** In the sidebar, opens the notifications bubble; `href` is its full page (the command palette's). */
  bell?: boolean
}

// Items without a page yet have no href: they look the same and say "coming soon".
export const NAV: { label?: string; items: NavItem[]; bottom?: boolean }[] = [
  {
    label: 'Work',
    items: [
      { label: 'Dashboard', icon: LayoutGrid, href: '/' },
      { label: 'Clients', icon: Building2, href: '/clients' },
      { label: 'Invoices', icon: ReceiptText, href: '/invoices' },
      { label: 'Quotes', icon: ScrollText, href: '/quotes' },
      { label: 'Products & services', icon: Package, href: '/products' },
      { label: 'Expenses', icon: Wallet, href: '/expenses' },
      { label: 'Engagements', icon: ClipboardCheck, href: '/engagements' },
      { label: 'Documents', icon: FileText, href: '/documents' },
    ],
  },
  {
    label: 'Team',
    items: [
      { label: 'Members', icon: Users, href: '/members' },
      { label: 'Employees', icon: IdCard, href: '/employees' },
      { label: 'Payroll', icon: Banknote, href: '/employees/payroll' },
    ],
  },
  {
    bottom: true,
    items: [
      { label: 'Ask Heidi', icon: HeidiSparkle, heidi: true, isNew: true },
      { label: 'Notifications', icon: Bell, href: '/notifications', bell: true },
    ],
  },
]

/** The menu without the pages these scopes cannot read, and without groups left empty. */
export function visibleNav(scopes: readonly string[]) {
  const allowed = ({ href }: NavItem) => {
    const resource = href ? resourceForPath(href) : null
    return !resource || can(scopes, `read:${resource}`)
  }
  return NAV.flatMap((group) => {
    const items = group.items.filter(allowed)
    return items.length > 0 ? [{ ...group, items }] : []
  })
}

/** What can be started from Quick Actions and the phone's "+"; no href yet means "coming soon". */
export const CREATE_ACTIONS: {
  label: string
  icon: ComponentType<{ className?: string }>
  need: Need
  href?: string
}[] = [
  { label: 'New invoice', icon: ReceiptText, need: 'write:invoices', href: '/invoices/new' },
  { label: 'New expense', icon: Wallet, need: 'write:expenses', href: '/expenses?new=1' },
  { label: 'New client', icon: Building2, need: 'write:clients', href: '/clients?new=1' },
  {
    label: 'New engagement',
    icon: ClipboardCheck,
    need: 'write:engagements',
    href: '/engagements?new=1',
  },
  { label: 'New product', icon: Package, need: 'write:products', href: '/products?new=1' },
  { label: 'Upload document', icon: FileUp, need: 'write:documents' },
  { label: 'Invite member', icon: UserPlus, need: 'write:members' },
]
