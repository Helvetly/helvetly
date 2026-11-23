'use client'
import { Loader } from '@helvetly/ui/components/loader'
import { formatPercent } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  FileText,
  Percent,
  Receipt,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { useExpenseSummary } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import {
  SUMMARY_PERIODS,
  chartNumber,
  formatWholeAmount,
  useInvoiceSummary,
  type SummaryPeriod,
} from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

import { TONES, ToneTile, type Tone } from './dashboard-card'
import { barHeights, change, share } from './figures'

/**
 * The dashboard's key figures as separate cards: what is owed, overdue and paid in the chosen period,
 * how much gets collected and this month's spending. Each opens the list behind it.
 */
export function DashboardKpis({ period }: { period: SummaryPeriod }) {
  const canReadInvoices = useCan('read:invoices')
  const canReadExpenses = useCan('read:expenses')
  if (!canReadInvoices && !canReadExpenses) return null
  return (
    <section aria-label={translate('keyFigures')} className="flex flex-wrap gap-4">
      {canReadInvoices && <InvoiceCards period={period} />}
      {canReadExpenses && <SpentCard />}
    </section>
  )
}

const plural = (count: number) =>
  `${count} ${count === 1 ? translate('invoice3') : translate('invoices3')}`

/** A card's place while its figures load. */
const pendingCard = (
  <Loader className="min-h-[132px] min-w-0 flex-[1_1_220px] rounded-xl border bg-card" />
)

function InvoiceCards({ period }: { period: SummaryPeriod }) {
  const summary = useInvoiceSummary(undefined, period).data
  if (!summary) return pendingCard
  const chosen = summary.period
  const named = SUMMARY_PERIODS.find((entry) => entry.value === chosen?.name)
  const paid = chosen?.paid ?? summary.paid_this_month
  const previous = chosen?.paid_previous ?? summary.paid_last_month
  const paidChange = change(paid.amount, previous.amount)
  const avgDays = chosen ? chosen.avg_days_to_pay : summary.avg_days_to_pay
  const collectionRate = chosen ? chosen.collection_rate : summary.collection_rate
  const overdueShare = share(summary.overdue.amount, summary.outstanding.amount)
  return (
    <>
      <KpiCard
        href="/invoices?status=open"
        icon={FileText}
        tone="brand"
        label={translate('outstanding')}
        unit={summary.currency}
        value={formatWholeAmount(summary.outstanding.amount)}
        context={translate('open3', { count: summary.outstanding.count })}
        chart={
          <MiniBars
            values={summary.monthly.map((month) => ({
              key: month.month,
              value: chartNumber(month.invoiced),
            }))}
          />
        }
      />
      <KpiCard
        href="/invoices?status=overdue"
        icon={CircleAlert}
        tone="warning"
        label={translate('overdue3')}
        unit={summary.currency}
        value={formatWholeAmount(summary.overdue.amount)}
        context={plural(summary.overdue.count)}
        chart={<ShareBar value={overdueShare} />}
      />
      <KpiCard
        href="/invoices?status=paid"
        icon={CircleCheck}
        tone="success"
        label={translate('paid2', { value1: named?.phrase ?? translate('thisMonth') })}
        unit={summary.currency}
        value={formatWholeAmount(paid.amount)}
        context={
          paidChange === null ? (
            plural(paid.count)
          ) : (
            <Change value={paidChange} good={paidChange >= 0}>
              {translate('vsPreviousPeriod')}
            </Change>
          )
        }
        chart={
          <MiniBars
            values={summary.monthly.map((month) => ({
              key: month.month,
              value: chartNumber(month.paid),
            }))}
          />
        }
      />
      <KpiCard
        href="/invoices?status=paid"
        icon={Percent}
        tone="info"
        label={translate('collectionRate')}
        value={collectionRate == null ? '—' : formatPercent(collectionRate)}
        context={
          avgDays == null
            ? translate('noneFullyPaidYet')
            : translate('avgDaysToPayValue', { days: Math.round(avgDays) })
        }
        chart={<ShareBar value={collectionRate ?? 0} />}
      />
    </>
  )
}

function SpentCard() {
  const spending = useExpenseSummary().data
  if (!spending) return pendingCard
  const spentChange = change(spending.this_month.amount, spending.last_month.amount)
  return (
    <KpiCard
      href="/expenses"
      icon={Receipt}
      tone="violet"
      label={translate('spentThisMonth')}
      unit={spending.currency}
      value={formatWholeAmount(spending.this_month.amount)}
      context={
        spentChange === null ? (
          translate('expensesCount', { count: spending.this_month.count })
        ) : (
          <Change value={spentChange} good={spentChange <= 0}>
            {translate('vsLastMonth')}
          </Change>
        )
      }
      chart={
        <MiniBars
          values={spending.monthly.map((month) => ({
            key: month.month,
            value: chartNumber(month.amount),
          }))}
        />
      }
    />
  )
}

/** One figure on its own card; the whole card opens the list behind it. */
function KpiCard({
  href,
  icon,
  tone,
  label,
  unit,
  value,
  context,
  chart,
}: {
  href: string
  icon: LucideIcon
  tone: Tone
  label: string
  /** Shown small and muted before the number, e.g. "CHF". */
  unit?: string
  value: string
  /** One short line under the number: a count, or the change against before. */
  context: ReactNode
  chart: ReactNode
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-[1_1_220px] flex-col gap-4 rounded-xl border bg-card p-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex items-center gap-2.5">
        <ToneTile icon={icon} tone={tone} />
        <span className="truncate text-body-sm text-muted-foreground">{label}</span>
        <ArrowUpRight
          aria-hidden
          className="ml-auto size-4 shrink-0 stroke-[1.5] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </span>
      {/* A long amount in a narrow card keeps every digit: the chart moves under it instead. */}
      <span className="mt-auto flex flex-wrap items-end justify-between gap-3">
        <span className="grid min-w-0 gap-1.5">
          <span className="flex items-baseline gap-1.5 text-display leading-none tracking-[-0.02em] tabular-nums">
            {unit && (
              <span className="text-body-sm tracking-normal text-muted-foreground">{unit}</span>
            )}
            <span className="truncate" title={value}>
              {value}
            </span>
          </span>
          <span className="truncate text-body-sm text-muted-foreground">{context}</span>
        </span>
        <span className={cn('ml-auto h-9 w-16 shrink-0', TONES[tone].chart)}>{chart}</span>
      </span>
    </Link>
  )
}

/** "↑ 12% vs last month", green when the change is a good one. */
function Change({ value, good, children }: { value: number; good: boolean; children: string }) {
  const Arrow = value >= 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-flex items-center', good ? 'text-success' : 'text-warning')}>
        <Arrow aria-hidden className="size-3.5" strokeWidth={2} />
        {value >= 0 ? '+' : '−'}
        {formatPercent(Math.abs(value))}
      </span>
      {children}
    </span>
  )
}

/** Small bars, one per month, the latest in full colour. */
export function MiniBars({ values }: { values: { key: string; value: number }[] }) {
  const heights = barHeights(values.map((entry) => entry.value))
  const step = 100 / Math.max(heights.length, 1)
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden className="size-full">
      {heights.map((height, i) => (
        <rect
          key={values[i]?.key}
          x={i * step + step * 0.18}
          width={step * 0.64}
          y={36 - height * 36}
          height={height * 36}
          rx={1.5}
          fill="currentColor"
          opacity={i === heights.length - 1 ? 1 : 0.32}
        />
      ))}
    </svg>
  )
}

/** A short rounded bar filled to `share` (0 to 1), with its percentage above. */
function ShareBar({ value }: { value: number }) {
  const label = formatPercent(Math.min(Math.max(value, 0), 1))
  return (
    <span className="flex size-full flex-col justify-end gap-1.5">
      <span className="text-right text-xs text-muted-foreground tabular-nums">{label}</span>
      <span className="block h-1.5 overflow-hidden rounded-full bg-current/15">
        <span
          className="block h-full rounded-full bg-current"
          style={{ width: `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%` }}
        />
      </span>
    </span>
  )
}
