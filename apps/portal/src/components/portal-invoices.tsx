'use client'
import { Callout } from '@helvetly/ui/components/callout'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Loader } from '@helvetly/ui/components/loader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { FileText, SearchX } from 'lucide-react'
import { useState } from 'react'

import { civilToday, dueText } from '@/lib/dates'
import { translate } from '@/lib/i18n'
import { isOpen, sumByCurrency } from '@/lib/invoices'
import {
  listPortalInvoices,
  portalKeys,
  type PortalInvoice,
  type PortalInvoiceList,
} from '@/lib/portal'

import {
  cardClass,
  EmptyState,
  InvoiceStatus,
  invoiceStatusLabel,
  PageHeader,
  PdfLink,
  RetryAlert,
  rowClass,
} from './portal-bits'

const FILTERS = {
  all: { label: translate('all'), test: () => true },
  open: { label: translate('open'), test: isOpen },
  overdue: { label: translate('overdue'), test: (i: PortalInvoice) => i.is_overdue },
  paid: { label: translate('paid'), test: (i: PortalInvoice) => i.status === 'paid' },
} satisfies Record<string, { label: string; test: (invoice: PortalInvoice) => boolean }>
type Filter = keyof typeof FILTERS
const isFilter = (value: string): value is Filter => value in FILTERS

/** One line per currency, never broken inside an amount. */
const money = (sums: [string, string][]) =>
  sums.length === 0 ? (
    <span className="font-normal text-muted-foreground">—</span>
  ) : (
    sums.map(([c, total]) => (
      <span key={c} className="block whitespace-nowrap">
        {formatMoney(total, c)}
      </span>
    ))
  )

function Summary({ data: invoices, paid_in: paid }: PortalInvoiceList) {
  const open = invoices.filter(isOpen)
  const overdue = invoices.filter((i) => i.is_overdue)
  const stats = [
    [translate('open'), money(sumByCurrency(open, (i) => i.amount_due)), false],
    [translate('overdue'), money(sumByCurrency(overdue, (i) => i.amount_due)), overdue.length > 0],
  ] as const
  const paidStat =
    paid &&
    ([translate('paidIn', { year: paid.year }), money(Object.entries(paid.totals)), false] as const)
  return (
    // Phones: Open and Overdue side by side, Paid on its own row below.
    <dl
      className={cn(
        cardClass,
        'grid grid-cols-2 sm:grid-cols-3 [&>*:nth-child(2)]:border-l [&>*:nth-child(3)]:max-sm:col-span-2 [&>*:nth-child(3)]:max-sm:border-t sm:[&>*:nth-child(3)]:border-l',
      )}
    >
      {(paidStat ? [...stats, paidStat] : stats).map(([label, value, alert]) => (
        <div key={label} className="grid min-w-0 content-start gap-1 px-4 py-4 sm:px-6 sm:py-5">
          <dt className="text-body-sm text-muted-foreground">{label}</dt>
          <dd
            // Not cn(): tailwind-merge would drop the type-scale size for the colour.
            className={`text-title font-semibold tracking-tight tabular-nums sm:text-page ${alert ? 'text-destructive' : ''}`}
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
    <li className={rowClass}>
      <IconTile icon={FileText} variant="row" size="lg" className="max-sm:hidden" />
      <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
        <span className="font-code truncate font-medium">{invoice.number}</span>
        <span
          // Not cn(): tailwind-merge would drop the type-scale size for the colour.
          className={`truncate text-body-sm ${invoice.is_overdue ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {open && invoice.due_date ? (
            dueText(invoice.due_date, today)
          ) : (
            <>
              {/* Below sm the badge is hidden: "Paid · 2 Jan 2026" instead of "Issued 2 Jan 2026". */}
              <span className="sm:hidden">{invoiceStatusLabel(invoice)} · </span>
              <span className="max-sm:hidden">{translate('issued')}</span>
              {formatDate(invoice.issue_date)}
            </>
          )}
        </span>
      </span>
      {/* A column of its own, so badges and amounts line up from row to row. */}
      <span className="w-24 shrink-0 max-sm:hidden">
        <InvoiceStatus invoice={invoice} />
      </span>
      <span className="grid shrink-0 text-right leading-tight tabular-nums sm:min-w-32">
        <span className="text-body font-medium">
          {formatMoney(invoice.total, invoice.currency)}
        </span>
        {open && invoice.amount_due !== invoice.total && (
          <span className="text-body-sm text-muted-foreground">
            {formatMoney(invoice.amount_due, invoice.currency)}
            {translate('open2')}
          </span>
        )}
      </span>
      {invoice.has_pdf !== false && <PdfLink invoice={invoice} />}
    </li>
  )
}

export function PortalInvoices() {
  const [filter, setFilter] = useState<Filter>('all')
  const today = civilToday()
  const query = useQuery({ queryKey: portalKeys.invoices, queryFn: listPortalInvoices })

  const body = () => {
    if (query.isPending) return <Loader label={translate('loadingInvoices')} className="min-h-72" />
    if (query.error)
      return (
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('yourInvoices')} onRetry={() => void query.refetch()} />
        </div>
      )
    const invoices = query.data.data
    if (invoices.length === 0)
      return (
        <div className={cardClass}>
          <EmptyState icon={FileText} title={translate('noInvoicesYet')}>
            {translate('invoicesAppearHereAsSoonAsTheyAreIssued')}
          </EmptyState>
        </div>
      )
    const shown = invoices.filter(FILTERS[filter].test)
    return (
      <>
        <Summary {...query.data} />
        <Tabs
          value={filter}
          onValueChange={(value) => isFilter(value) && setFilter(value)}
          className="gap-4"
        >
          <TabsList
            aria-label={translate('show')}
            className="h-9 max-w-full overflow-x-auto bg-card shadow-elevation-1"
          >
            {Object.entries(FILTERS).map(([key, { label, test }]) => (
              <TabsTrigger key={key} value={key} className="px-3">
                {label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {invoices.filter(test).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={filter} className="grid gap-4">
            {shown.length === 0 ? (
              <div className={cardClass}>
                <EmptyState
                  icon={SearchX}
                  title={translate('noInvoices', { value1: FILTERS[filter].label.toLowerCase() })}
                >
                  {translate('chooseAllToSeeEveryInvoice')}
                </EmptyState>
              </div>
            ) : (
              <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
                {shown.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} today={today} />
                ))}
              </ul>
            )}
            <Callout tone="neutral" icon={FileText} className="bg-transparent">
              {translate('paymentDetailsInInvoicePdf')}
            </Callout>
          </TabsContent>
        </Tabs>
      </>
    )
  }

  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader title={translate('invoices')}>
        {translate('everyInvoiceIssuedToYouEachWithItsPDF')}
      </PageHeader>
      {body()}
    </div>
  )
}
