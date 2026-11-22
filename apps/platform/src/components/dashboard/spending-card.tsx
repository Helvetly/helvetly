'use client'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { formatPercent } from '@helvetly/ui/lib/format'
import { PieChart } from 'lucide-react'

import { Money } from '@/components/invoices/invoice-bits'
import { errorMessage } from '@/lib/api'
import { categoryLabel } from '@/lib/expense-categories'
import { useExpenseSummary } from '@/lib/expenses'
import { translate } from '@/lib/i18n'

import { DashboardCard } from './dashboard-card'
import { share } from './figures'

const SHOWN = 5

/** This month's spending by category, the largest first, each with its share of the month. */
export function SpendingCard({ className }: { className?: string }) {
  const summary = useExpenseSummary()
  const data = summary.data
  const rows = data?.by_category.slice(0, SHOWN) ?? []
  return (
    <DashboardCard
      title={translate('spendingByCategory')}
      icon={PieChart}
      tone="violet"
      help={translate('spendingByCategoryHelp')}
      viewAll={{ href: '/expenses', label: translate('allExpenses') }}
      className={className}
    >
      {summary.error ? (
        <div className="grid justify-items-start gap-3 px-4 pt-2 pb-4">
          <p role="alert" className="text-sm text-muted-foreground">
            {translate('spendingCouldnTBeLoaded')}
            {errorMessage(summary.error)}
          </p>
          <Button size="sm" variant="outline" onClick={() => void summary.refetch()}>
            {translate('retrySpending')}
          </Button>
        </div>
      ) : !data ? (
        <Loader className="min-h-40" />
      ) : rows.length === 0 ? (
        <p className="px-4 pt-6 pb-10 text-center text-body-sm text-muted-foreground">
          {translate('noExpensesThisMonthYet')}
        </p>
      ) : (
        <ul className="grid gap-3 px-4 pt-2 pb-4">
          {rows.map((row) => {
            const part = share(row.amount, data.this_month.amount)
            const name = row.category
              ? categoryLabel(row.category)
              : translate('uncategorisedFolder')
            return (
              <li key={row.category?.id ?? 'none'} className="grid gap-1.5">
                <span className="flex items-baseline gap-3 text-body-sm">
                  <span className="truncate">{name}</span>
                  <span className="text-muted-foreground tabular-nums">{formatPercent(part)}</span>
                  <Money value={row.amount} currency={data.currency} className="ml-auto" />
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-violet-surface">
                  <span
                    className="block h-full rounded-full bg-violet-solid/70"
                    style={{ width: `${Math.max(Math.round(part * 100), 2)}%` }}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardCard>
  )
}
