'use client'

import { Loader } from '@helvetly/ui/components/loader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { FileText, QrCode, SearchX } from 'lucide-react'
import { useState } from 'react'

import { civilToday, dueText } from '@/lib/dates'
import { isOpen, sumByCurrency } from '@/lib/invoices'
import { listPortalInvoices, portalKeys, type PortalInvoice } from '@/lib/portal'

import {
  cardClass,
  EmptyState,
  InvoiceStatus,
  PageHeader,
  PdfLink,
  RetryAlert,
} from './portal-bits'

const FILTERS = {
  all: { label: 'All', test: () => true },
  open: { label: 'Open', test: isOpen },
  overdue: { label: 'Overdue', test: (i: PortalInvoice) => i.is_overdue },
  paid: { label: 'Paid', test: (i: PortalInvoice) => i.status === 'paid' },
} satisfies Record<string, { label: string; test: (invoice: PortalInvoice) => boolean }>
type Filter = keyof typeof FILTERS
const isFilter = (value: string): value is Filter => value in FILTERS

/** One line per currency, never broken inside an amount. */
const money = (sums: [string, string][]) =>
  sums.length === 0
    ? '—'
    : sums.map(([c, total]) => (
        <span key={c} className="block whitespace-nowrap">
          {formatMoney(total, c)}
        </span>
      ))

function Summary({ invoices, today }: { invoices: PortalInvoice[]; today: string }) {
  const open = invoices.filter(isOpen)
  const overdue = invoices.filter((i) => i.is_overdue)
  const year = today.slice(0, 4)
  const paid = invoices.filter((i) => i.status === 'paid' && i.issue_date.startsWith(year))
  const stats = [
    ['Open', money(sumByCurrency(open, (i) => i.amount_due)), false],
    ['Overdue', money(sumByCurrency(overdue, (i) => i.amount_due)), overdue.length > 0],
    [`Paid in ${year}`, money(sumByCurrency(paid, (i) => i.total)), false],
  ] as const
  return (
    // Phones: Open and Overdue side by side, Paid on its own row below.
    <dl
      className={cn(
        cardClass,
        'grid grid-cols-2 sm:grid-cols-3 [&>*:nth-child(2)]:border-l [&>*:nth-child(3)]:max-sm:col-span-2 [&>*:nth-child(3)]:max-sm:border-t sm:[&>*:nth-child(3)]:border-l',
      )}
    >
      {stats.map(([label, value, alert]) => (
        <div key={label} className="grid min-w-0 content-start gap-0.5 px-4 py-3 sm:px-5 sm:py-4">
          <dt className="text-body-sm text-muted-foreground">{label}</dt>
          <dd
            className={cn(
              'text-base font-semibold tracking-tight tabular-nums sm:text-lg',
              alert && 'text-destructive',
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function InvoiceRow({ invoice, today }: { invoice: PortalInvoice; today: string }) {
  const open = isOpen(invoice)
  return (
    <li className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground max-sm:hidden">
        <FileText className="size-[18px]" aria-hidden />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium">{invoice.number}</span>
          <span className="max-sm:hidden">
            <InvoiceStatus invoice={invoice} />
          </span>
        </span>
        <span
          // Not cn(): tailwind-merge would drop the type-scale size for the colour.
          className={`truncate text-body-sm ${invoice.is_overdue ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {open && invoice.due_date ? (
            dueText(invoice.due_date, today)
          ) : (
            <>
              {/* Below sm the badge is hidden: "Paid · 2 Jan 2026" instead of "Issued 2 Jan 2026". */}
              <span className="sm:hidden">
                <span className="capitalize">{invoice.status}</span> ·{' '}
              </span>
              <span className="max-sm:hidden">Issued </span>
              {formatDate(invoice.issue_date)}
            </>
          )}
        </span>
      </span>
      <span className="grid shrink-0 text-right leading-tight tabular-nums">
        <span className="text-body font-medium">
          {formatMoney(invoice.total, invoice.currency)}
        </span>
        {open && invoice.amount_due !== invoice.total && (
          <span className="text-body-sm text-muted-foreground">
            {formatMoney(invoice.amount_due, invoice.currency)} open
          </span>
        )}
      </span>
      <PdfLink invoice={invoice} />
    </li>
  )
}

export function PortalInvoices() {
  const [filter, setFilter] = useState<Filter>('all')
  const today = civilToday()
  const query = useQuery({ queryKey: portalKeys.invoices, queryFn: listPortalInvoices })

  const body = () => {
    if (query.isPending) return <Loader label="Loading invoices" className="min-h-72" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-5')}>
          <RetryAlert what="Your invoices" onRetry={() => void query.refetch()} />
        </div>
      )
    if (query.data.length === 0)
      return (
        <div className={cardClass}>
          <EmptyState icon={FileText} title="No invoices yet">
            Invoices appear here as soon as they are issued to you.
          </EmptyState>
        </div>
      )
    const shown = query.data.filter(FILTERS[filter].test)
    return (
      <>
        <Summary invoices={query.data} today={today} />
        <Tabs
          value={filter}
          onValueChange={(value) => isFilter(value) && setFilter(value)}
          className="gap-3"
        >
          <TabsList
            aria-label="Show"
            className="max-w-full overflow-x-auto bg-card shadow-elevation-1"
          >
            {Object.entries(FILTERS).map(([key, { label, test }]) => (
              <TabsTrigger key={key} value={key} className="px-2.5">
                {label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {query.data.filter(test).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={filter} className="grid gap-3">
            {shown.length === 0 ? (
              <div className={cardClass}>
                <EmptyState
                  icon={SearchX}
                  title={`No ${FILTERS[filter].label.toLowerCase()} invoices`}
                >
                  Choose “All” to see every invoice.
                </EmptyState>
              </div>
            ) : (
              <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
                {shown.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} today={today} />
                ))}
              </ul>
            )}
            <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
              <QrCode className="size-4 shrink-0" aria-hidden /> Pay with the Swiss QR bill in each
              PDF.
            </p>
          </TabsContent>
        </Tabs>
      </>
    )
  }

  return (
    <div className="grid gap-5 sm:gap-6">
      <PageHeader title="Invoices">Every invoice issued to you, each with its PDF.</PageHeader>
      {body()}
    </div>
  )
}
