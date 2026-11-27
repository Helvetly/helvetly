'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@helvetly/ui/components/chart'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { formatDate, formatWhole } from '@helvetly/ui/lib/format'
import { CalendarRange, ChartSpline } from 'lucide-react'
import { useState } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import { NativeSelect } from '@/components/clients/fields'
import { errorMessage, type CashFlowPoint } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { useDashboard } from '@/lib/queries'

import { monthRows, yearToDate, yearsWithData, type Measure } from './cash-flow-years'
import { CHART_BODY, CHART_PLOT, CHART_SUMMARY, DashboardCard, SERIES } from './dashboard-card'

const PERIODS = [
  { value: '30d', label: translate('message30d') },
  { value: '90d', label: translate('message90d') },
  { value: '12m', label: translate('message12m') },
] as const
type Period = (typeof PERIODS)[number]['value']
const MEASURES = [
  { value: 'income', label: translate('income2') },
  { value: 'expenses', label: translate('expenses') },
  { value: 'net', label: translate('cashFlowNet') },
] as const
// This year in blue, the year before in violet, then amber, teal and rose: apart at a glance.
const YEAR_COLORS = [SERIES[0], SERIES[3], SERIES[4], SERIES[2], SERIES[1]]
const calendarMonth = (month: number, style: 'short' | 'long') =>
  new Date(Date.UTC(2026, month, 1)).toLocaleDateString(languageTag, {
    month: style,
    timeZone: 'UTC',
  })
const percent = new Intl.NumberFormat(languageTag, {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
})
const compact = new Intl.NumberFormat(languageTag, {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const chartConfig = {
  income: { label: translate('income2'), color: SERIES[0] },
  expenses: { label: translate('expenses'), color: SERIES[1] },
} satisfies ChartConfig
const tickDate = (period: Period) => (iso: string) =>
  new Date(iso).toLocaleDateString(
    languageTag,
    period === '12m' ? { month: 'short' } : { day: 'numeric', month: 'short' },
  )

/** The dashboard's cash flow in the currency this card chose, with the picker when there are several. */
function useCashFlow() {
  const [currency, setCurrency] = useState<string>()
  const dashboard = useDashboard(currency)
  // Keeps the picker while another currency loads.
  const [currencies, setCurrencies] = useState<string[]>([])
  const available = dashboard.data?.currencies ?? currencies
  const picker = available.length > 1 && (
    <NativeSelect
      aria-label={translate('cashFlowCurrency')}
      value={dashboard.data?.currency ?? currency}
      onChange={(event) => {
        setCurrencies(available)
        setCurrency(event.target.value)
      }}
    >
      {available.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </NativeSelect>
  )
  return { dashboard, picker, unit: dashboard.data?.currency ?? currency ?? '—' }
}

/** Says which side is missing when the person reads only invoices or only expenses. */
function PartialNote() {
  const canReadInvoices = useCan('read:invoices')
  const canReadExpenses = useCan('read:expenses')
  if (canReadInvoices && canReadExpenses) return null
  return (
    <p className="text-xs text-muted-foreground">
      {canReadInvoices
        ? translate('invoicePaymentsAndRefundsOnlyExpensesAreNotIncluded')
        : translate('paidExpensesOnlyInvoicePaymentsAndRefundsAreNot')}
    </p>
  )
}

function LoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className={`grid content-center justify-items-start gap-3 ${CHART_BODY}`}>
      <p role="alert" className="text-sm text-muted-foreground">
        {translate('cashFlowCouldnTBeLoaded')}
        {errorMessage(error)}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {translate('retryCashFlow')}
      </Button>
    </div>
  )
}

/**
 * Money in against money out. A year is bars per month, so a quiet year with one busy month still
 * reads month by month; 30 and 90 days are an income area over a dashed expenses line.
 */
export function CashFlowCard({ className }: { className?: string }) {
  const { dashboard, picker, unit } = useCashFlow()
  const [period, setPeriod] = useState<Period>('12m')
  const points = dashboard.data?.cash_flow[period] ?? []
  const income = points.reduce((sum, point) => sum + point.income, 0)
  const expenses = points.reduce((sum, point) => sum + point.expenses, 0)

  return (
    <DashboardCard
      title={translate('cashFlow')}
      icon={ChartSpline}
      help={translate('cashFlowHelp')}
      className={className}
      actions={
        <>
          {picker}
          <Segmented
            size="sm"
            label={translate('period')}
            value={period}
            options={[...PERIODS]}
            onChange={setPeriod}
          />
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-4 px-4 pt-1 pb-4">
        {!dashboard.error && (
          <div className={SUMMARY_ROW}>
            <output aria-label={translate('netCashFlow')} className={HEADLINE}>
              <span className="text-body-sm tracking-normal text-muted-foreground">{unit}</span>
              {dashboard.data ? formatWhole(income - expenses) : '—'}
              <span className="text-body-sm tracking-normal text-muted-foreground">
                {translate('net')}
              </span>
            </output>
            <p className={LEGEND}>
              <LegendChip color={SERIES[0]} label={translate('income2')}>
                {dashboard.data && `${unit} ${formatWhole(income)}`}
              </LegendChip>
              <LegendChip color={SERIES[1]} label={translate('expenses')}>
                {dashboard.data && `${unit} ${formatWhole(expenses)}`}
              </LegendChip>
            </p>
          </div>
        )}
        <PartialNote />
        {dashboard.error ? (
          <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        ) : dashboard.data ? (
          <ChartContainer
            config={chartConfig}
            className={`mt-auto aspect-auto w-full ${CHART_PLOT}`}
          >
            <ComposedChart data={points} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboard-income" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-income)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-income)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tickFormatter={tickDate(period)}
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(max, 1)]}
                tickFormatter={(value: number) => compact.format(value)}
              />
              <ChartTooltip
                cursor={period === '12m' ? { fill: 'var(--muted)' } : { stroke: 'var(--border)' }}
                content={
                  <ChartTooltipContent
                    className="min-w-44"
                    labelFormatter={(_, payload) => {
                      const date: unknown = payload[0]?.payload?.date
                      if (typeof date !== 'string') return ''
                      return period === '12m'
                        ? new Date(date).toLocaleDateString(languageTag, {
                            month: 'long',
                            year: 'numeric',
                          })
                        : formatDate(date)
                    }}
                  />
                }
              />
              {period === '12m' ? (
                <>
                  <Bar
                    dataKey="income"
                    fill="var(--color-income)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={18}
                  />
                  <Bar
                    dataKey="expenses"
                    fill="var(--color-expenses)"
                    fillOpacity={0.8}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={18}
                  />
                </>
              ) : (
                <>
                  <Area
                    dataKey="income"
                    type="monotone"
                    stroke="var(--color-income)"
                    strokeWidth={1.75}
                    fill="url(#dashboard-income)"
                    activeDot={{ r: 3.5 }}
                  />
                  <Line
                    dataKey="expenses"
                    type="monotone"
                    stroke="var(--color-expenses)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </>
              )}
            </ComposedChart>
          </ChartContainer>
        ) : (
          <Loader className={`mt-auto ${CHART_PLOT}`} />
        )}
      </div>
    </DashboardCard>
  )
}

/**
 * Calendar years side by side, January to December, in one measure (income, expenses or net), so
 * this year reads against the last; years switch on and off. Needs records in two years.
 */
export function YearOverYearCard({ className }: { className?: string }) {
  const { dashboard, picker, unit } = useCashFlow()
  const [measure, setMeasure] = useState<Measure>('income')
  const [chosenYears, setYears] = useState<number[]>()
  const points = dashboard.data?.cash_flow.years ?? []
  const years = yearsWithData(points)
  const shown = (chosenYears ?? years.slice(0, 2)).filter((year) => years.includes(year))
  const comparable = years.length > 1

  return (
    <DashboardCard
      title={translate('yearOverYear')}
      icon={CalendarRange}
      tone="violet"
      help={translate('yearOverYearHelp')}
      className={className}
      actions={
        <>
          {picker}
          {comparable && (
            <Segmented
              size="sm"
              label={translate('cashFlowMeasure')}
              value={measure}
              options={[...MEASURES]}
              onChange={setMeasure}
            />
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-4 px-4 pt-1 pb-4">
        {dashboard.error ? (
          <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        ) : !dashboard.data ? (
          <Loader className={CHART_BODY} />
        ) : !comparable ? (
          <EmptyState
            icon={CalendarRange}
            title={translate('yearOverYearEmpty')}
            description={translate('yearOverYearEmptyBody')}
            className={`content-center ${CHART_BODY}`}
          />
        ) : (
          <YearsChart
            points={points}
            years={years}
            shown={shown}
            onShownChange={setYears}
            measure={measure}
            unit={unit}
          />
        )}
      </div>
    </DashboardCard>
  )
}

/** Up to five years in one measure, the latest shown year's total so far as the headline. */
function YearsChart({
  points,
  years,
  shown,
  onShownChange,
  measure,
  unit,
}: {
  points: CashFlowPoint[]
  years: number[]
  shown: number[]
  onShownChange: (years: number[]) => void
  measure: Measure
  unit: string
}) {
  const latest = shown[0] ?? years[0]
  if (latest === undefined) return null
  const { total, change } = yearToDate(points, measure, latest)
  const color = (year: number) => YEAR_COLORS[years.indexOf(year)] ?? YEAR_COLORS[0]
  const config = Object.fromEntries(
    years.map((year) => [year, { label: String(year), color: color(year) }]),
  ) satisfies ChartConfig
  const toggle = (year: number) =>
    onShownChange(
      shown.includes(year)
        ? shown.filter((other) => other !== year)
        : years.filter((other) => other === year || shown.includes(other)),
    )

  return (
    <>
      <div className={SUMMARY_ROW}>
        <output
          aria-label={translate('cashFlowYearToDate', { year: String(latest) })}
          className={HEADLINE}
        >
          <span className="text-body-sm tracking-normal text-muted-foreground">{unit}</span>
          {formatWhole(total)}
          <span className="truncate text-body-sm tracking-normal text-muted-foreground">
            {translate('cashFlowYearToDateShort', { year: String(latest) })}
            {change !== null &&
              ` · ${translate('cashFlowVsYear', { change: percent.format(change), year: String(latest - 1) })}`}
          </span>
        </output>
        <fieldset className={LEGEND}>
          <legend className="sr-only">{translate('cashFlowYearsShown')}</legend>
          {years.map((year) => (
            <button
              key={year}
              type="button"
              aria-pressed={shown.includes(year)}
              // The last year shown stays: an empty chart says nothing.
              disabled={shown.length === 1 && shown[0] === year}
              onClick={() => toggle(year)}
              className={`${CHIP} transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default aria-[pressed=false]:bg-transparent aria-[pressed=false]:text-muted-foreground`}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: shown.includes(year) ? color(year) : 'var(--border)' }}
              />
              {year}
            </button>
          ))}
        </fieldset>
      </div>
      <PartialNote />
      <ChartContainer config={config} className={`mt-auto aspect-auto w-full ${CHART_PLOT}`}>
        <ComposedChart
          data={monthRows(points, measure)}
          margin={{ left: 0, right: 4, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={(month: number) => calendarMonth(month, 'short')}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            domain={measure === 'net' ? ['auto', 'auto'] : [0, (max: number) => Math.max(max, 1)]}
            tickFormatter={(value: number) => compact.format(value)}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--border)' }}
            content={
              <ChartTooltipContent
                className="min-w-44"
                labelFormatter={(_, payload) => {
                  const month: unknown = payload[0]?.payload?.month
                  return typeof month === 'number' ? calendarMonth(month, 'long') : ''
                }}
              />
            }
          />
          {shown.map((year) => (
            <Line
              key={year}
              dataKey={String(year)}
              type="monotone"
              stroke={`var(--color-${year})`}
              strokeWidth={year === latest ? 2 : 1.5}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ChartContainer>
    </>
  )
}

// The figure, then the legend: two lines of fixed height wherever the card is.
const SUMMARY_ROW = `grid content-center gap-2 ${CHART_SUMMARY}`
const HEADLINE =
  'flex min-w-0 items-baseline gap-1.5 text-display leading-none tracking-[-0.02em] whitespace-nowrap tabular-nums'
const LEGEND = 'flex min-w-0 flex-wrap items-center gap-1.5'
const CHIP =
  'inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2 text-caption whitespace-nowrap tabular-nums'

/** A legend entry as a small chip: the series' colour dot, its name and its total. */
function LegendChip({
  color,
  label,
  children,
}: {
  color: string
  label: string
  children: string | undefined
}) {
  return (
    <span className={CHIP}>
      <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
      <span>{label}</span>
      {children && <span className="text-muted-foreground">{children}</span>}
    </span>
  )
}
