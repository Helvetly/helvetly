'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { formatMoney } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { useMutation } from '@tanstack/react-query'
import { Download, Ellipsis, FilePlus2, Mail, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { RecordLink } from '@/components/record-link'
import { useClient } from '@/lib/clients'
import {
  invoicePeriod,
  periodLabel,
  reportUrl,
  type Engagement,
  type Period,
  unpriced,
} from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { UNITS } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

import { plain, ProgressBar, Tip, withUnit } from './engagement-bits'
import { friendlyError, useRefreshEngagement } from './entry-log'
import { SendReportDialog } from './send-report-dialog'

/** "h" for hours; the unit as it is when unknown. */
export const unitShort = (unit: string | null) =>
  UNITS.find((entry) => entry.value === unit)?.short ?? unit ?? ''

const STATE = {
  open: translate('current'),
  upcoming: translate('upcoming'),
  closed: translate('closed'),
}

/** Every period with what was used, its invoices, and the ways to invoice it. */
export function PeriodsPanel({
  engagement,
  periods,
}: {
  engagement: Engagement
  periods: Period[]
}) {
  const router = useRouter()
  const refresh = useRefreshEngagement()
  const unit = engagement.unit
  const short = unitShort(unit)
  const client = useClient(engagement.client.id).data
  const writeEngagements = useCan('write:engagements')
  const writeInvoices = useCan('write:invoices')
  // Invoicing a period creates an invoice, so it needs both.
  const canInvoice = writeEngagements && writeInvoices
  const [sending, setSending] = useState<Period | null>(null)
  const detailLabel = {
    summary: translate('oneSummaryLine'),
    per_entry: translate('oneLinePerEntry'),
  } as const
  const otherDetail = engagement.invoice_detail === 'summary' ? 'per_entry' : 'summary'
  const invoice = useMutation({
    mutationFn: ({
      period,
      kind,
      detail,
    }: {
      period: Period
      kind: 'advance' | 'usage'
      detail?: 'summary' | 'per_entry'
    }) => invoicePeriod(engagement.id, period.id, { kind, detail }),
    onSuccess: ({ data }) => {
      refresh()
      router.push(`/invoices/edit?id=${encodeURIComponent(data.invoice_id)}`)
    },
    onError: (error: unknown) => toast.error(friendlyError(error)),
  })

  return (
    <ul className="divide-y divide-border/60">
      {periods.map((period) => {
        // Paid separately: nothing to invoice, and no price to show.
        const hasUsage = !unpriced(engagement) && Number(period.uninvoiced_quantity) > 0
        const upfront = canInvoice && engagement.billing === 'advance' && !unpriced(engagement)
        const upfrontOpen = upfront && period.advance_invoice === null
        const busy = invoice.isPending
        const primary = !canInvoice
          ? null
          : upfrontOpen
            ? {
                label: translate('invoiceUpfront'),
                run: () => invoice.mutate({ period, kind: 'advance' }),
              }
            : hasUsage
              ? {
                  label: translate('invoiceUsage2'),
                  run: () =>
                    invoice.mutate({ period, kind: 'usage', detail: engagement.invoice_detail }),
                }
              : null
        const facts = [
          !unpriced(engagement) &&
            `${formatMoney(period.unit_price, engagement.currency)}${short ? ` / ${short}` : ''}`,
          Number(period.invoiced_quantity) > 0 &&
            `${withUnit(period.invoiced_quantity, unit)} invoiced`,
          hasUsage && `${withUnit(period.uninvoiced_quantity, unit)} to invoice`,
          Number(period.carried_in) > 0 && `+${withUnit(period.carried_in, unit)} carried over`,
          period.full_quantity !== period.quantity &&
            `prorated from ${withUnit(period.full_quantity, unit)}`,
        ].filter(Boolean)
        return (
          <li key={period.id} className="grid gap-2 py-3 first:pt-1 last:pb-0">
            <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-body font-medium whitespace-nowrap">{periodLabel(period)}</span>
              <Badge tone={STATUS_TONES.period[period.state]}>{STATE[period.state]}</Badge>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {primary && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={primary.run}>
                    <FilePlus2 />
                    {primary.label}
                  </Button>
                )}
                <DropdownMenu>
                  <Tip label={translate('moreActions')}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={translate('periodActions')}
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tip>
                  <DropdownMenuContent align="end" className="min-w-60">
                    {upfront && primary?.label !== 'Invoice upfront' && (
                      <DropdownMenuItem
                        disabled={!upfrontOpen || busy}
                        onSelect={() => invoice.mutate({ period, kind: 'advance' })}
                      >
                        <FilePlus2 />
                        {upfrontOpen ? translate('invoiceUpfront') : translate('invoicedUpfront')}
                      </DropdownMenuItem>
                    )}
                    {canInvoice && primary?.label !== 'Invoice usage' && (
                      <DropdownMenuItem
                        disabled={!hasUsage || busy}
                        onSelect={() =>
                          invoice.mutate({
                            period,
                            kind: 'usage',
                            detail: engagement.invoice_detail,
                          })
                        }
                      >
                        <FilePlus2 />
                        {translate('invoiceUsage2')}
                      </DropdownMenuItem>
                    )}
                    {canInvoice && (
                      <DropdownMenuItem
                        disabled={!hasUsage || busy}
                        onSelect={() =>
                          invoice.mutate({ period, kind: 'usage', detail: otherDetail })
                        }
                      >
                        <FilePlus2 />
                        {translate('invoiceUsage')}
                        {detailLabel[otherDetail].toLowerCase()}
                      </DropdownMenuItem>
                    )}
                    {canInvoice && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onSelect={() =>
                        window.open(reportUrl(engagement.id, period.id, true), '_blank')
                      }
                    >
                      <Download />
                      {translate('downloadReport')}
                    </DropdownMenuItem>
                    {writeEngagements && (
                      <DropdownMenuItem onSelect={() => setSending(period)}>
                        <Mail />
                        {translate('sendReport')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <ProgressBar period={period} unit={unit} caption={false} />
              </div>
              <span className="text-body-sm whitespace-nowrap text-muted-foreground tabular-nums">
                <span className="font-medium text-foreground">{plain(period.used)}</span> /{' '}
                {withUnit(period.available, unit)}
              </span>
            </div>
            <p className="text-caption text-muted-foreground tabular-nums">{facts.join(' · ')}</p>
            {Number(period.unearned) > 0 && period.advance_invoice && (
              <p className="flex items-center gap-1.5 text-body-sm text-warning">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                <span>
                  {period.unearned} {short}
                  {translate('wereInvoicedUpfrontButNotDelivered')}{' '}
                  <RecordLink
                    href={`/invoices?id=${encodeURIComponent(period.advance_invoice.id)}`}
                    className="underline underline-offset-2"
                  >
                    {translate('issueACreditNote')}
                  </RecordLink>
                </span>
              </p>
            )}
            {period.invoices.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {period.invoices.map((link) => (
                  <RecordLink key={link.id} href={`/invoices?id=${encodeURIComponent(link.id)}`}>
                    <Badge tone={STATUS_TONES.invoice[link.status]}>
                      {link.kind === 'advance' ? translate('upfront') : translate('usage')} ·{' '}
                      {link.number ?? translate('draft')}
                    </Badge>
                  </RecordLink>
                ))}
              </div>
            )}
          </li>
        )
      })}
      {sending && (
        <SendReportDialog
          engagementId={engagement.id}
          period={sending}
          defaultTo={client?.billing_email ?? client?.email ?? null}
          open
          onOpenChange={(open) => !open && setSending(null)}
        />
      )}
    </ul>
  )
}
