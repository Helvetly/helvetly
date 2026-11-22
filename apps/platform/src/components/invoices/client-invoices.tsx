'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { CalendarRange, FilePlus2, Plus, ReceiptText } from 'lucide-react'
import Link from 'next/link'

import { RecordLink } from '@/components/record-link'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { issuedCount, PLAN_STATUS_LABELS } from '@/lib/instalments'
import {
  DEFAULT_PARAMS,
  formatDay,
  formatMoney,
  INTERVALS,
  toCents,
  useInvoiceSummary,
  useInvoiceList,
} from '@/lib/invoices'

import { newInvoiceHref } from './compose'
import { InvoiceNumber, Money, RowStatus } from './invoice-bits'
import { usePlans } from './plan-card'

/** The client's invoices (GET /invoices?client_id=…), newest first, with a "New invoice" start. */
export function ClientInvoices({ clientId }: { clientId: string }) {
  const list = useInvoiceList({ ...DEFAULT_PARAMS, client: clientId })
  const summary = useInvoiceSummary(clientId).data
  const rows = list.data?.data ?? []
  const total = list.data?.meta.total ?? 0

  if (list.error)
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        {errorMessage(list.error)}
      </p>
    )
  if (!list.data) return <Loader className="min-h-72" />
  if (rows.length === 0)
    return (
      <div className="grid justify-items-center gap-2 rounded-xl bg-card px-6 py-12 text-center shadow-elevation-1">
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ReceiptText className="size-5 stroke-[1.5]" />
        </span>
        <p className="text-[15px] font-medium">{translate('noInvoicesYet')}</p>
        <p className="max-w-xs text-[13px] text-pretty text-muted-foreground">
          {translate('invoicesForThisClientShowUpHereWithWhat')}
        </p>
        <Button asChild size="sm" className="mt-2">
          <RecordLink href={newInvoiceHref(clientId)}>
            <FilePlus2 />
            {translate('newInvoice2')}
          </RecordLink>
        </Button>
      </div>
    )

  return (
    <div className="grid gap-3">
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl bg-card px-4 py-3.5 shadow-elevation-1">
        {summary && summary.outstanding.count > 0 ? (
          <div className="grid gap-0.5">
            <span className="text-[12px] text-muted-foreground">
              {translate('open2')}
              {summary.outstanding.count} {summary.outstanding.count === 1 ? 'invoice' : 'invoices'}
            </span>
            <span className="text-[18px] tracking-[-0.01em] tabular-nums">
              {formatMoney(summary.outstanding.amount, summary.currency)}
            </span>
            {summary.overdue.count > 0 && (
              <span className="text-[12px] text-[#b5544f] tabular-nums dark:text-rose-300">
                {formatMoney(summary.overdue.amount, summary.currency)}
                {translate('overdue2')}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[13.5px] text-muted-foreground">
            {summary ? translate('nothingOpenEveryInvoiceIsSettled') : translate('loading')}
          </span>
        )}
        {summary && toCents(summary.paid_this_month.amount) > 0n && (
          <div className="grid gap-0.5">
            <span className="text-[12px] text-muted-foreground">{translate('paidThisMonth')}</span>
            <span className="text-[18px] tracking-[-0.01em] tabular-nums">
              {formatMoney(summary.paid_this_month.amount, summary.currency)}
            </span>
          </div>
        )}
        <Button asChild className="ml-auto">
          <RecordLink href={newInvoiceHref(clientId)}>
            <Plus />
            {translate('newInvoice2')}
          </RecordLink>
        </Button>
      </section>
      <ClientPlans clientId={clientId} />
      <section className="rounded-xl bg-card shadow-elevation-1">
        <ul className="divide-y divide-border/60">
          {rows.map((invoice) => (
            <li key={invoice.id}>
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(invoice.id)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40"
              >
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="text-[14px]">
                    <InvoiceNumber invoice={invoice} />
                    {invoice.kind === 'credit_note' && (
                      <span className="text-muted-foreground">{translate('creditNote')}</span>
                    )}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {formatDay(invoice.issue_date)}
                    {translate('due2')}
                    {formatDay(invoice.due_date)}
                  </span>
                </span>
                <Money
                  value={invoice.payable_total}
                  currency={invoice.currency}
                  negative={invoice.kind === 'credit_note'}
                  className="text-[14px]"
                />
                <span className="w-[72px] text-right">
                  <RowStatus invoice={invoice} />
                </span>
              </RecordLink>
            </li>
          ))}
        </ul>
        {total > rows.length && (
          <Link
            href={`/invoices?client=${encodeURIComponent(clientId)}`}
            className="block border-t border-border/60 px-4 py-2.5 text-center text-[13px] text-muted-foreground hover:text-foreground"
          >
            {translate('all2')}
            {total}
            {translate('invoices2')}
          </Link>
        )}
      </section>
    </div>
  )
}

/** The client's running instalment plans, each opening its source draft. */
function ClientPlans({ clientId }: { clientId: string }) {
  const running = (usePlans(clientId).data ?? []).filter(
    (plan) => plan.status === 'active' || plan.status === 'paused',
  )
  if (running.length === 0) return null
  return (
    <section
      aria-label={translate('instalmentPlans')}
      className="rounded-xl bg-card shadow-elevation-1"
    >
      <ul className="divide-y divide-border/60">
        {running.map((plan) => {
          const next = plan.items.find((item) => item.status === 'scheduled')
          return (
            <li key={plan.id}>
              <RecordLink
                href={`/invoices?id=${encodeURIComponent(plan.source_invoice_id)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40"
              >
                <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="text-[14px]">
                    {translate('instalmentPlan')}
                    {issuedCount(plan)}
                    {translate('of5')}
                    {plan.count}
                    {translate('issued')}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {INTERVALS.find((entry) => entry.value === plan.interval)?.label}
                    {next && translate('nextIssued', { value1: formatDay(next.issue_on) })}
                  </span>
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  {PLAN_STATUS_LABELS[plan.status]}
                </span>
              </RecordLink>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
