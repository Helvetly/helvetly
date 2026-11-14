import type { QueryClient } from '@tanstack/react-query'

import { clientListQuery, DEFAULT_PARAMS as CLIENTS } from '@/lib/clients'
import { docListQuery, foldersQuery, listQuery, parseView } from '@/lib/documents'
import { ALL_STATUSES, engagementListQuery } from '@/lib/engagements'
import { expenseListQuery, DEFAULT_PARAMS as EXPENSES } from '@/lib/expenses'
import { invoiceListQuery, DEFAULT_PARAMS as INVOICES } from '@/lib/invoices'
import { invitationsQuery, membersQuery } from '@/lib/members'
import { productListQuery, DEFAULT_PARAMS as PRODUCTS } from '@/lib/products'

// The queries each page runs on a fresh visit (no query string), keyed by the page's href.
const PAGES: Record<
  string,
  () => { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }[]
> = {
  '/clients': () => [clientListQuery(CLIENTS)],
  '/invoices': () => [invoiceListQuery(INVOICES)],
  '/products': () => [productListQuery(PRODUCTS)],
  '/expenses': () => [expenseListQuery(EXPENSES)],
  '/engagements': () => [engagementListQuery({ status: ALL_STATUSES, q: undefined, page: 1 })],
  '/documents': () => [
    foldersQuery,
    docListQuery(listQuery(parseView(new URLSearchParams()), undefined)),
  ],
  '/members': () => [membersQuery, invitationsQuery],
}

/** Starts loading the first page of `href`'s list while the pointer rests on its nav item; fresh data is left alone. */
export function warmPage(queryClient: QueryClient, href: string) {
  for (const query of PAGES[href]?.() ?? []) void queryClient.prefetchQuery(query)
}
