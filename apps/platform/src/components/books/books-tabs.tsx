'use client'
import { BookOpen, CalendarCheck, Landmark } from 'lucide-react'
import type { ReactNode } from 'react'

import { TabsHeader, type Page } from '@/components/settings/settings-tabs'
import { translate } from '@/lib/i18n'
import { useInvoiceSettings } from '@/lib/invoices'

/** The books in the order of a month-end: close the months, declare VAT, hand the ledger on. */
export const BOOKS_PAGES: Page[] = [
  { label: translate('closing'), href: '/books', icon: CalendarCheck },
  { label: translate('vatReturn'), href: '/books/vat-return', icon: Landmark },
  { label: translate('ledger'), href: '/books/ledger', icon: BookOpen },
]

/** The top bar of a books page: closing, VAT return and ledger as tabs, and the page's own actions. */
export function BooksHeader({ actions }: { actions?: ReactNode }) {
  // A business not registered for VAT files no VAT return: the tab shows once the invoice settings say it is.
  const notVatRegistered = useInvoiceSettings().data?.vat_registered === false
  const pages = notVatRegistered
    ? BOOKS_PAGES.filter((page) => page.href !== '/books/vat-return')
    : BOOKS_PAGES
  return <TabsHeader pages={pages} actions={actions} />
}
