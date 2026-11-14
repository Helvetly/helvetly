'use client'

import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { TONES } from '@helvetly/ui/components/status-badge'
import { formatDate, formatMoney, formatSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { civilToday, daysLeftText, dueText, greeting, sharedText } from '@/lib/dates'
import { byUrgency, sumByCurrency } from '@/lib/invoices'
import {
  getPortalSession,
  listPortalDocuments,
  listPortalEngagements,
  listPortalInvoices,
  portalDocumentUrl,
  portalKeys,
  type PortalInvoice,
} from '@/lib/portal'
import { isAwaiting, listPortalQuotes, quoteName } from '@/lib/quotes'

import {
  cardClass,
  DownloadLink,
  FileTile,
  InvoiceStatus,
  PageHeader,
  PdfLink,
  RetryAlert,
  SectionTitle,
} from './portal-bits'
import { UsageBar } from './portal-engagements'
import { QuotePdfLink } from './portal-quotes'

const moneyList = (sums: [string, string][]) =>
  sums.map(([currency, total]) => formatMoney(total, currency)).join(' · ')

const viewAll = (href: string, label: string) => (
  <Link
    href={href}
    className="text-body-sm text-link underline underline-offset-2 hover:no-underline"
  >
    {label}
  </Link>
)

function AmountDue({ invoices, today }: { invoices: PortalInvoice[]; today: string }) {
  const urgent = byUrgency(invoices)
  const due = sumByCurrency(urgent, (i) => i.amount_due)
  const overdue = urgent.filter((i) => i.is_overdue)
  const next = urgent.find((i) => !i.is_overdue && i.due_date)?.due_date

  if (due.length === 0)
    return (
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-toggle-surface text-toggle">
          <CircleCheck className="size-5" aria-hidden />
        </span>
        <div className="grid">
          <p className="font-medium">You’re all set — nothing is due</p>
          <p className="text-sm text-muted-foreground">New invoices will show up here.</p>
        </div>
      </div>
    )

  return (
    <div className="grid gap-4">
      {overdue.length > 0 && (
        <p className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', TONES.red)}>
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {overdue.length === 1 ? '1 invoice is' : `${overdue.length} invoices are`} overdue:{' '}
            <strong className="font-medium whitespace-nowrap tabular-nums">
              {moneyList(sumByCurrency(overdue, (i) => i.amount_due))}
            </strong>
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          {due.map(([currency, total]) => (
            <p key={currency} className="text-3xl font-semibold tracking-tight tabular-nums">
              {formatMoney(total, currency)}
            </p>
          ))}
          <p className="text-sm text-muted-foreground">
            {urgent.length === 1 ? '1 open invoice' : `${urgent.length} open invoices`}
            {next && ` · ${dueText(next, today).replace(/^Due/, 'next due')} (${formatDate(next)})`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/invoices">View invoices</Link>
        </Button>
      </div>
    </div>
  )
}

function Attention({ invoices, today }: { invoices: PortalInvoice[]; today: string }) {
  const top = byUrgency(invoices).slice(0, 3)
  if (top.length === 0) return null
  return (
    <section
      aria-labelledby="overview-attention"
      className={cn(cardClass, 'grid gap-1 p-4 sm:p-5')}
    >
      <SectionTitle id="overview-attention" action={viewAll('/invoices', 'All invoices')}>
        Needs your attention
      </SectionTitle>
      <ul className="-mx-2 grid">
        {top.map((invoice) => (
          <li key={invoice.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-body font-medium">{invoice.number}</span>
              <span
                className={`text-body-sm ${invoice.is_overdue ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {invoice.due_date ? dueText(invoice.due_date, today) : 'No due date'}
              </span>
            </span>
            <span className="max-sm:hidden">
              <InvoiceStatus invoice={invoice} />
            </span>
            <span className="text-right text-body font-medium tabular-nums">
              {formatMoney(invoice.amount_due, invoice.currency)}
            </span>
            <PdfLink invoice={invoice} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Quotes waiting for the client's answer; nothing while there are none (or they failed to load). */
function QuotesToAnswer() {
  const query = useQuery({ queryKey: portalKeys.quotes, queryFn: listPortalQuotes })
  const awaiting = query.data?.filter(isAwaiting) ?? []
  if (awaiting.length === 0) return null
  return (
    <section aria-labelledby="overview-quotes" className={cn(cardClass, 'grid gap-1 p-4 sm:p-5')}>
      <SectionTitle id="overview-quotes" action={viewAll('/quotes', 'Answer quotes')}>
        Quotes to answer
      </SectionTitle>
      <ul className="-mx-2 grid">
        {awaiting.slice(0, 3).map((quote) => (
          <li key={quote.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-body font-medium">{quoteName(quote)}</span>
              <span className="text-body-sm text-muted-foreground">
                Valid until {formatDate(quote.valid_until)}
              </span>
            </span>
            <span className="text-right text-body font-medium tabular-nums">
              {formatMoney(quote.total, quote.currency)}
            </span>
            <QuotePdfLink quote={quote} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Engagements({ today }: { today: string }) {
  const query = useQuery({ queryKey: portalKeys.engagements, queryFn: listPortalEngagements })
  const running = query.data?.filter((e) => e.current_period) ?? []
  if (query.isSuccess && running.length === 0) return null
  return (
    <section
      aria-labelledby="overview-engagements"
      className={cn(cardClass, 'grid gap-3 p-4 sm:p-5')}
    >
      <SectionTitle id="overview-engagements" action={viewAll('/engagements', 'Details')}>
        Engagements
      </SectionTitle>
      {query.isPending ? (
        <Loader className="min-h-12" />
      ) : query.error ? (
        <RetryAlert what="Engagements" onRetry={() => void query.refetch()} />
      ) : (
        <ul className="grid gap-4">
          {running.map((engagement) => {
            const period = engagement.current_period
            if (!period) return null
            const share =
              Number(engagement.quantity) > 0
                ? Number(period.used) / Number(engagement.quantity)
                : 0
            return (
              <li key={engagement.id} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-body">
                  <span className="truncate font-medium">{engagement.name}</span>
                  <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}% used
                  </span>
                </div>
                <UsageBar engagement={engagement} />
                <p className="text-body-sm text-muted-foreground">
                  {Number(period.used)} of {Number(engagement.quantity)} {engagement.unit} ·{' '}
                  {daysLeftText(period.ends_on, today)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RecentDocuments({ today }: { today: string }) {
  const query = useQuery({ queryKey: portalKeys.documents, queryFn: listPortalDocuments })
  if (query.isSuccess && query.data.length === 0) return null
  return (
    <section
      aria-labelledby="overview-documents"
      className={cn(cardClass, 'grid gap-1 p-4 sm:p-5')}
    >
      <SectionTitle id="overview-documents" action={viewAll('/documents', 'All documents')}>
        Recently shared
      </SectionTitle>
      {query.isPending ? (
        <Loader className="mt-2 min-h-12" />
      ) : query.error ? (
        <RetryAlert what="Documents" onRetry={() => void query.refetch()} />
      ) : (
        <ul className="-mx-2 grid">
          {query.data.slice(0, 3).map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <FileTile contentType={doc.content_type} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-body">{doc.name}</span>
                <span className="text-body-sm text-muted-foreground">
                  <span className="max-sm:hidden">{formatSize(doc.size)} · </span>
                  {sharedText(doc.shared_at, today)}
                </span>
              </span>
              <DownloadLink href={portalDocumentUrl(doc.id)} label={`Download ${doc.name}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Greeting, amount due (overdue first), invoices to act on, engagement usage and new documents. */
export function PortalOverview() {
  const today = civilToday()
  const [hour] = useState(() => new Date().getHours())
  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: getPortalSession,
    retry: false,
  })
  const invoices = useQuery({ queryKey: portalKeys.invoices, queryFn: listPortalInvoices })
  const name = session.data?.client.name

  return (
    <div className="grid gap-5 sm:gap-6">
      <PageHeader title={`${greeting(hour)}${name ? `, ${name}` : ''}`}>
        {session.data &&
          `${session.data.workspace.name} shares your invoices, work and documents here.`}
      </PageHeader>
      <section aria-labelledby="overview-due" className={cn(cardClass, 'grid gap-4 p-4 sm:p-6')}>
        <h2
          id="overview-due"
          className="flex items-center gap-2 text-body-sm font-medium text-muted-foreground"
        >
          <Wallet className="size-4 text-brand" aria-hidden /> Amount due
        </h2>
        {invoices.isPending ? (
          <Loader className="min-h-16" />
        ) : invoices.error ? (
          <RetryAlert what="Your invoices" onRetry={() => void invoices.refetch()} />
        ) : (
          <AmountDue invoices={invoices.data} today={today} />
        )}
      </section>
      {invoices.data && <Attention invoices={invoices.data} today={today} />}
      <QuotesToAnswer />
      <Engagements today={today} />
      <RecentDocuments today={today} />
    </div>
  )
}
