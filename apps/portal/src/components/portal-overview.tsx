'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { TONES } from '@helvetly/ui/components/status-badge'
import { formatDate, formatMoney, formatSize } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleAlert, CircleCheck, Wallet } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { civilToday, daysLeftText, dueText, greeting, sharedText } from '@/lib/dates'
import { translate } from '@/lib/i18n'
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
          <p className="font-medium">{translate('youReAllSetNothingIsDue')}</p>
          <p className="text-sm text-muted-foreground">{translate('newInvoicesWillShowUpHere')}</p>
        </div>
      </div>
    )

  return (
    <div className="grid gap-4">
      {overdue.length > 0 && (
        <p className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-body ${TONES.red}`}>
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {overdue.length === 1
              ? translate('message1InvoiceIs')
              : translate('invoicesAre', { length: overdue.length })}
            {translate('overdue2')}{' '}
            <strong className="font-medium whitespace-nowrap tabular-nums">
              {moneyList(sumByCurrency(overdue, (i) => i.amount_due))}
            </strong>
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-2">
          {due.map(([currency, total]) => (
            <p key={currency} className="text-display font-semibold tracking-tight tabular-nums">
              {formatMoney(total, currency)}
            </p>
          ))}
          <p className="text-body text-muted-foreground">
            {urgent.length === 1
              ? translate('message1OpenInvoice')
              : translate('openInvoices', { length: urgent.length })}
            {next && (
              <>
                {` · ${dueText(next, today).replace(/^Due/, 'next due')} `}
                <span className="whitespace-nowrap">({formatDate(next)})</span>
              </>
            )}
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/invoices">
            {translate('viewInvoices')}
            <ArrowRight data-icon="inline-end" />
          </Link>
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
      className={cn(cardClass, 'grid content-start gap-2 p-4 sm:p-6')}
    >
      <SectionTitle id="overview-attention" action={viewAll('/invoices', translate('allInvoices'))}>
        {translate('needsYourAttention')}
      </SectionTitle>
      <ul className="-mx-2 grid divide-y divide-border/70">
        {top.map((invoice) => (
          <li key={invoice.id} className="flex items-center gap-3 px-2 py-3">
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-body font-medium">{invoice.number}</span>
              <span
                className={`text-body-sm ${invoice.is_overdue ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {invoice.due_date ? dueText(invoice.due_date, today) : translate('noDueDate')}
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
    <section
      aria-labelledby="overview-quotes"
      className={cn(cardClass, 'grid content-start gap-2 p-4 sm:p-6')}
    >
      <SectionTitle id="overview-quotes" action={viewAll('/quotes', translate('answerQuotes'))}>
        {translate('quotesToAnswer')}
      </SectionTitle>
      <ul className="-mx-2 grid divide-y divide-border/70">
        {awaiting.slice(0, 3).map((quote) => (
          <li key={quote.id} className="flex items-center gap-3 px-2 py-3">
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-body font-medium">{quoteName(quote)}</span>
              <span className="text-body-sm text-muted-foreground">
                {translate('validUntil')}
                {formatDate(quote.valid_until)}
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
      className={cn(cardClass, 'grid content-start gap-4 p-4 sm:p-6')}
    >
      <SectionTitle
        id="overview-engagements"
        action={viewAll('/engagements', translate('details'))}
      >
        {translate('engagements')}
      </SectionTitle>
      {query.isPending ? (
        <Loader className="min-h-12" />
      ) : query.error ? (
        <RetryAlert what={translate('engagements')} onRetry={() => void query.refetch()} />
      ) : (
        <ul className="grid gap-5">
          {running.map((engagement) => {
            const period = engagement.current_period
            if (!period) return null
            const share =
              Number(engagement.quantity) > 0
                ? Number(period.used) / Number(engagement.quantity)
                : 0
            return (
              <li key={engagement.id} className="grid gap-2">
                <div className="flex items-baseline justify-between gap-3 text-body">
                  <span className="truncate font-medium">{engagement.name}</span>
                  <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}
                    {translate('used')}
                  </span>
                </div>
                <UsageBar engagement={engagement} />
                <p className="text-body-sm text-muted-foreground">
                  {Number(period.used)}
                  {translate('of')}
                  {Number(engagement.quantity)} {engagement.unit} ·{' '}
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
      className={cn(cardClass, 'grid content-start gap-2 p-4 sm:p-6')}
    >
      <SectionTitle
        id="overview-documents"
        action={viewAll('/documents', translate('allDocuments'))}
      >
        {translate('recentlyShared')}
      </SectionTitle>
      {query.isPending ? (
        <Loader className="mt-2 min-h-12" />
      ) : query.error ? (
        <RetryAlert what={translate('documents')} onRetry={() => void query.refetch()} />
      ) : (
        <ul className="-mx-2 grid divide-y divide-border/70">
          {query.data.slice(0, 3).map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-2 py-3">
              <FileTile contentType={doc.content_type} />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-body">{doc.name}</span>
                <span className="text-body-sm text-muted-foreground">
                  <span className="max-sm:hidden">{formatSize(doc.size)} · </span>
                  {sharedText(doc.shared_at, today)}
                </span>
              </span>
              <DownloadLink
                href={portalDocumentUrl(doc.id)}
                label={translate('download2', { name: doc.name })}
              />
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
    <div className="grid gap-6 sm:gap-8">
      <PageHeader title={`${greeting(hour)}${name ? `, ${name}` : ''}`}>
        {session.data &&
          translate('sharesYourInvoicesWorkAndDocumentsHere', {
            name: session.data.workspace.name,
          })}
      </PageHeader>
      {/* Wide screens: what is due on the left, engagements and files beside it (gone when empty). */}
      <div className="grid gap-5 sm:gap-6 lg:flex lg:items-start">
        <div className="grid min-w-0 gap-5 sm:gap-6 lg:flex-1">
          <section
            aria-labelledby="overview-due"
            className={cn(cardClass, 'grid gap-5 p-5 sm:p-8')}
          >
            <h2
              id="overview-due"
              className="flex items-center gap-2 text-body font-medium text-muted-foreground"
            >
              <Wallet className="size-4 text-brand" aria-hidden />
              {translate('amountDue')}
            </h2>
            {invoices.isPending ? (
              <Loader className="min-h-16" />
            ) : invoices.error ? (
              <RetryAlert
                what={translate('yourInvoices')}
                onRetry={() => void invoices.refetch()}
              />
            ) : (
              <AmountDue invoices={invoices.data} today={today} />
            )}
          </section>
          {invoices.data && <Attention invoices={invoices.data} today={today} />}
          <QuotesToAnswer />
        </div>
        <div className="grid min-w-0 gap-5 empty:hidden sm:gap-6 lg:w-96 lg:shrink-0">
          <Engagements today={today} />
          <RecentDocuments today={today} />
        </div>
      </div>
    </div>
  )
}
