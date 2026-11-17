import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import {
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

import { employeesHidden, featureLock } from '@/components/billing/feature-lock'
import type { Billing, FeatureKey } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { can, canReadPath, type Need } from '@/lib/permissions'

export type NavItem = {
  label: string
  icon: ComponentType<{ className?: string }>
  href?: string
  isNew?: boolean
  /** Opens Heidi's panel instead of a page. */
  heidi?: boolean
  /** In the sidebar, opens the notifications bubble; `href` is its full page (the command palette's). */
  bell?: boolean
  /** The plan feature it needs; without it the item carries the plan's tag. */
  feature?: FeatureKey
}

// Items without a page yet have no href: they look the same and say "coming soon".
export const NAV: { label?: string; items: NavItem[]; bottom?: boolean }[] = [
  {
    label: translate('work'),
    items: [
      { label: translate('dashboard'), icon: LayoutGrid, href: '/' },
      { label: translate('clients'), icon: Building2, href: '/clients' },
      { label: translate('invoices'), icon: ReceiptText, href: '/invoices' },
      { label: translate('quotes'), icon: ScrollText, href: '/quotes' },
      { label: translate('productsServices'), icon: Package, href: '/products' },
      { label: translate('expenses'), icon: Wallet, href: '/expenses', feature: 'expenses' },
      { label: translate('engagements'), icon: ClipboardCheck, href: '/engagements' },
      { label: translate('documents'), icon: FileText, href: '/documents' },
    ],
  },
  {
    label: translate('team'),
    items: [
      { label: translate('members'), icon: Users, href: '/members' },
      {
        label: translate('employees'),
        icon: IdCard,
        href: '/employees',
        feature: 'employees',
      },
    ],
  },
  {
    bottom: true,
    items: [
      {
        label: translate('askHeidi'),
        icon: HeidiSparkle,
        heidi: true,
        isNew: true,
        feature: 'heidi',
      },
      { label: translate('notifications'), icon: Bell, href: '/notifications', bell: true },
    ],
  },
]

/** The menu without the pages these scopes cannot read, and without groups left empty. */
export function visibleNav(scopes: readonly string[], billing?: Billing) {
  const allowed = ({ href, feature }: NavItem) =>
    (!href || canReadPath(scopes, href)) && !(feature === 'employees' && employeesHidden(billing))
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
  feature?: FeatureKey
}[] = [
  {
    label: translate('newInvoice'),
    icon: ReceiptText,
    need: 'write:invoices',
    href: '/invoices/new',
  },
  {
    label: translate('newExpense'),
    icon: Wallet,
    need: 'write:expenses',
    href: '/expenses?new=1',
    feature: 'expenses',
  },
  { label: translate('newClient'), icon: Building2, need: 'write:clients', href: '/clients?new=1' },
  {
    label: translate('newEngagement2'),
    icon: ClipboardCheck,
    need: 'write:engagements',
    href: '/engagements?new=1',
  },
  {
    label: translate('newProduct'),
    icon: Package,
    need: 'write:products',
    href: '/products?new=1',
  },
  { label: translate('uploadDocument'), icon: FileUp, need: 'write:documents' },
  { label: translate('inviteMember'), icon: UserPlus, need: 'write:members' },
]

/** What these scopes may start on the workspace's plan. */
export const startable = (scopes: readonly string[], billing: Billing | undefined) =>
  CREATE_ACTIONS.filter(
    ({ need, feature }) => can(scopes, need) && !(feature && featureLock(billing, feature)),
  )
