'use client'

import { formatPercent } from '@helvetly/ui/lib/format'

import { Kpi, KpiBand, Sparkline, TickGauge } from '@/components/kpi-band'
import { useExpenseSummary } from '@/lib/expenses'
import { chartNumber, formatWholeAmount, toCents } from '@/lib/invoices'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The expense figures from GET /expenses/summary, in the workspace currency. */
export function ExpenseKpis() {
  const summary = useExpenseSummary().data
  const thisMonth = summary ? toCents(summary.this_month.amount) : 0n
  const lastMonth = summary ? toCents(summary.last_month.amount) : 0n
  // A change only means something with spending in both months.
  const change =
    lastMonth > 0n && thisMonth > 0n
      ? Number(((thisMonth - lastMonth) * 1000n) / lastMonth) / 1000
      : null
  const top = summary?.by_category[0]
  const topShare =
    summary && top && thisMonth > 0n ? Number((toCents(top.amount) * 1000n) / thisMonth) / 1000 : 0

  return (
    <KpiBand loading={!summary}>
      {summary && (
        <>
          <Kpi
            label="Spent this month"
            unit={summary.currency}
            value={formatWholeAmount(summary.this_month.amount)}
            note={
              change === null
                ? plural(summary.this_month.count, 'expense', 'expenses')
                : `${change >= 0 ? '+' : '−'}${formatPercent(Math.abs(change))}`
            }
            chart={<Sparkline values={summary.monthly.map((month) => chartNumber(month.amount))} />}
          />
          <Kpi
            label="Unpaid"
            unit={summary.currency}
            value={formatWholeAmount(summary.unpaid.amount)}
            note={
              summary.overdue.count
                ? `${summary.overdue.count} overdue`
                : plural(summary.unpaid.count, 'bill', 'bills')
            }
            chart={
              <TickGauge
                share={summary.unpaid.count ? summary.overdue.count / summary.unpaid.count : 0}
              />
            }
          />
          <Kpi
            label="To reimburse"
            unit={summary.currency}
            value={formatWholeAmount(summary.to_reimburse.amount)}
            note={plural(summary.to_reimburse.count, 'expense', 'expenses')}
            chart={null}
          />
          <Kpi
            label={`Input VAT ${summary.input_vat.period.replace('-', ' ')}`}
            unit={summary.currency}
            value={formatWholeAmount(summary.input_vat.amount)}
            note={
              summary.incomplete.count ? `${summary.incomplete.count} to complete` : 'reclaimable'
            }
            chart={null}
          />
          <Kpi
            label={top?.category ? `Top: ${top.category.name}` : 'Top category'}
            value={top ? formatPercent(topShare) : '—'}
            note={top ? 'of this month' : 'nothing this month'}
            chart={<TickGauge share={topShare} />}
          />
        </>
      )}
    </KpiBand>
  )
}
