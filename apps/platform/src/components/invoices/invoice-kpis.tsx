'use client'
import { formatPercent } from '@helvetly/ui/lib/format'

import { Kpi, KpiBand, Sparkline, TickGauge } from '@/components/kpi-band'
import { translate } from '@/lib/i18n'
import {
  SUMMARY_PERIODS,
  chartNumber,
  formatWholeAmount,
  toCents,
  useInvoiceSummary,
  type SummaryPeriod,
} from '@/lib/invoices'

/** A ratio of two amounts, for a gauge or a percentage (display only). */
const share = (part: string, whole: string) => {
  const denominator = toCents(whole)
  return denominator > 0n ? Number((toCents(part) * 1000n) / denominator) / 1000 : 0
}

/**
 * The invoice figures from GET /invoices/summary, shared by the dashboard and the invoices page. With
 * a period, money paid, days to pay and the collection rate are that period's; the rest is today's.
 */
export function InvoiceKpis({ period }: { period?: SummaryPeriod }) {
  const summary = useInvoiceSummary(undefined, period).data
  const chosen = summary?.period
  const named = SUMMARY_PERIODS.find((entry) => entry.value === chosen?.name)
  const paid = chosen?.paid ?? summary?.paid_this_month
  const previous = chosen?.paid_previous ?? summary?.paid_last_month
  const paidChange = paid && previous ? share(paid.amount, previous.amount) - 1 : 0
  // A change against the previous period only means something once this one has payments too.
  const hasPrevious =
    paid && previous ? toCents(previous.amount) > 0n && toCents(paid.amount) > 0n : false
  const avgDays = chosen ? chosen.avg_days_to_pay : summary?.avg_days_to_pay
  const collectionRate = chosen ? chosen.collection_rate : summary?.collection_rate
  return (
    <KpiBand loading={!summary}>
      {summary && (
        <>
          <Kpi
            label={translate('outstanding')}
            unit={summary.currency}
            value={formatWholeAmount(summary.outstanding.amount)}
            note={translate('open3', { count: summary.outstanding.count })}
            chart={
              <Sparkline values={summary.monthly.map((month) => chartNumber(month.invoiced))} />
            }
          />
          <Kpi
            label={translate('overdue3')}
            unit={summary.currency}
            value={formatWholeAmount(summary.overdue.amount)}
            note={`${summary.overdue.count} ${summary.overdue.count === 1 ? translate('invoice3') : translate('invoices3')}`}
            chart={<TickGauge share={share(summary.overdue.amount, summary.outstanding.amount)} />}
          />
          <Kpi
            trending={hasPrevious && paidChange > 0}
            label={translate('paid2', { value1: named?.phrase ?? translate('thisMonth') })}
            unit={summary.currency}
            value={formatWholeAmount((paid ?? summary.paid_this_month).amount)}
            note={
              hasPrevious
                ? `${paidChange >= 0 ? '+' : '−'}${formatPercent(Math.abs(paidChange))}`
                : undefined
            }
            chart={<Sparkline values={summary.monthly.map((month) => chartNumber(month.paid))} />}
          />
          {/* Only while someone is owed money back: it is a to-do, not a figure to watch. */}
          {toCents(summary.refund_due.amount) > 0n && (
            <Kpi
              label={translate('refundDue')}
              unit={summary.currency}
              value={formatWholeAmount(summary.refund_due.amount)}
              note={`${summary.refund_due.count} ${summary.refund_due.count === 1 ? translate('invoice3') : translate('invoices3')}`}
              chart={<TickGauge share={1} />}
            />
          )}
          <Kpi
            label={translate('avgDaysToPay')}
            value={avgDays == null ? '—' : String(Math.round(avgDays))}
            note={
              avgDays == null
                ? translate('noneFullyPaidYet')
                : (named?.label.toLowerCase() ?? translate('last90Days'))
            }
            chart={<TickGauge share={(avgDays ?? 0) / 60} />}
          />
          <Kpi
            label={translate('collectionRate')}
            value={collectionRate == null ? '—' : formatPercent(collectionRate)}
            note={named?.label.toLowerCase() ?? translate('message12Months')}
            chart={<TickGauge share={collectionRate ?? 0} />}
          />
        </>
      )}
    </KpiBand>
  )
}
