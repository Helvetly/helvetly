'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@helvetly/ui/components/chart'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { formatDate, formatWhole } from '@helvetly/ui/lib/format'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChartSpline,
  ChevronDown,
  CircleCheck,
  Landmark,
  LayoutGrid,
  ListTodo,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import { NativeSelect } from '@/components/clients/fields'
import {
  useLegalFormMissing,
  useMonthsToClose,
  useVatReturnDue,
} from '@/components/dashboard/attention'
import { EngagementsCard } from '@/components/engagements/engagements-card'
import { Initials } from '@/components/initials'
import { Money, RowStatus } from '@/components/invoices/invoice-bits'
import { RecordLink, useDrawers } from '@/components/record-link'
import { TodayCard } from '@/components/scheduling/today-card'
import { PageHeader } from '@/components/shell/page-header'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  DEFAULT_PARAMS,
  SUMMARY_PERIODS,
  dueLabel,
  formatRange,
  isPositive,
  invoiceListQuery,
  useInvoiceSummary,
  type SummaryPeriod,
} from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { useDashboard, useSession } from '@/lib/queries'

import { DashboardCard, LIST_ROW, ToneTile, type Tone } from './dashboard-card'
import { DashboardKpis } from './dashboard-kpis'
import { firstName, greetingKey } from './figures'
import { SpendingCard } from './spending-card'

const GREETINGS = {
  goodMorningName: [
    () => translate('goodMorning'),
    (name: string) => translate('goodMorningName', { name }),
  ],
  goodAfternoonName: [
    () => translate('goodAfternoon'),
    (name: string) => translate('goodAfternoonName', { name }),
  ],
  goodEveningName: [
    () => translate('goodEvening'),
    (name: string) => translate('goodEveningName', { name }),
  ],
} as const

/** "Good morning, Anna" by the person's clock; without a name, just the greeting. */
function greeting(name: string | undefined, now = new Date()) {
  const [plain, named] = GREETINGS[greetingKey(now.getHours())]
  const first = firstName(name)
  return first ? named(first) : plain()
}

export function Dashboard() {
  const drawers = useDrawers()
  const session = useSession()
  const [period, setPeriod] = useRememberedPeriod()
  const canInvoice = useCan('write:invoices')
  const canReadInvoices = useCan('read:invoices')
  const canReadExpenses = useCan('read:expenses')
  const canReadEngagements = useCan('read:engagements')
  const canReadScheduling = useCan('read:scheduling')
  const canReadPeriods = useCan('read:periods')
  const canReadVATReturn = useCan('read:vat-return')
  const canReadBooks = canReadPeriods || canReadVATReturn
  if (session.error) {
    return (
      <div className="grid justify-items-start gap-3 p-5">
        <p role="alert" className="text-sm text-muted-foreground">
          {translate('workspaceOverviewCouldnTBeLoaded')}
          {errorMessage(session.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void session.refetch()}>
          {translate('retryWorkspaceOverview')}
        </Button>
      </div>
    )
  }
  if (!session.data) {
    return (
      <div className="p-5">
        <Loader label={translate('loadingWorkspaceOverview')} className="min-h-56" />
      </div>
    )
  }
  const showCashFlow = canReadInvoices || canReadExpenses
  const showAttention = canReadInvoices || canReadBooks
  return (
    <>
      <PageHeader
        tabs={[translate('dashboard')]}
        tabIcons={[LayoutGrid]}
        primary={canInvoice ? translate('newInvoice') : undefined}
        onPrimary={() => drawers.open({ kind: 'invoice', mode: 'new' })}
        actions={canReadInvoices && <PeriodFilter value={period} onChange={setPeriod} />}
      />
      <div className="grid flex-1 content-start gap-4 p-4 md:p-6">
        <div className="grid min-w-0 gap-1">
          {/* The page's heading is the bar's "Dashboard"; the greeting is its welcome. */}
          <p className="truncate text-page leading-tight font-medium tracking-[-0.01em]">
            {greeting(session.data.user.name)}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {translate('heresWhatSHappeningWithYourBusiness')}
          </p>
        </div>
        <DashboardKpis period={period} />
        {(showCashFlow || showAttention) && (
          <div className="flex flex-wrap gap-4">
            {showCashFlow && <CashFlow />}
            {showAttention && <NeedsAttention />}
          </div>
        )}
        {(canReadEngagements || canReadExpenses || canReadScheduling) && (
          <div className="flex flex-wrap gap-4 empty:hidden">
            {canReadScheduling && <TodayCard className="min-w-0 flex-[1_1_360px]" />}
            {canReadEngagements && <EngagementsCard className="min-w-0 flex-[1_1_360px]" />}
            {canReadExpenses && <SpendingCard className="min-w-0 flex-[1_1_360px]" />}
          </div>
        )}
        {!canReadInvoices && !canReadBooks && !canReadExpenses && !canReadEngagements && (
          <p className="text-sm text-muted-foreground">
            {translate('yourWorkspaceOverviewShowsTheSectionsYouHavePermission')}
          </p>
        )}
      </div>
    </>
  )
}

const PERIOD_KEY = 'helvetly.dashboard.period'

/** The dashboard's period, remembered in this browser (storage may be unavailable: then this month). */
function useRememberedPeriod() {
  const [period, setPeriod] = useState<SummaryPeriod>(() => {
    try {
      const saved = window.localStorage.getItem(PERIOD_KEY)
      return SUMMARY_PERIODS.find((entry) => entry.value === saved)?.value ?? 'this_month'
    } catch {
      return 'this_month'
    }
  })
  const choose = (next: SummaryPeriod) => {
    setPeriod(next)
    try {
      window.localStorage.setItem(PERIOD_KEY, next)
    } catch {
      // Not remembered; the choice still applies now.
    }
  }
  return [period, choose] as const
}

/** The period of the key figures: one button naming the period and its dates, a menu to change it. */
function PeriodFilter({
  value,
  onChange,
}: {
  value: SummaryPeriod
  onChange: (period: SummaryPeriod) => void
}) {
  // The same query the key figures run; the range is the workspace's, resolved by the API.
  const resolved = useInvoiceSummary(undefined, value).data?.period
  const range = resolved?.name === value ? formatRange(resolved.from, resolved.to) : null
  const label = SUMMARY_PERIODS.find((period) => period.value === value)?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-0 font-normal">
          <CalendarDays className="stroke-[1.5] text-muted-foreground" />
          <span className="sr-only">{translate('period2')}</span>
          <span className="truncate">{label}</span>
          {range && (
            <span className="truncate text-muted-foreground @max-[40rem]:hidden">{range}</span>
          )}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {translate('keyFiguresFor')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const period = SUMMARY_PERIODS.find((entry) => entry.value === next)
            if (period) onChange(period.value)
          }}
        >
          {SUMMARY_PERIODS.map((period) => (
            <DropdownMenuRadioItem key={period.value} value={period.value}>
              {period.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Open invoices and money owed back to customers, the most urgent first.
const ATTENTION = {
  ...DEFAULT_PARAMS,
  status: ['open' as const, 'refund_due' as const],
  kind: 'invoice' as const,
  sort: 'due_date' as const,
  desc: false,
}

const list = new Intl.ListFormat(languageTag, { type: 'conjunction' })
// The latest few months, so their names alone are clear: "September and October".
const monthName = new Intl.DateTimeFormat(languageTag, { month: 'long', timeZone: 'UTC' })
const monthLabel = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`))

/**
 * The workspace's to-do list, most important first: the VAT return, months to close, the company's missing legal form,
 * open invoices.
 */
function NeedsAttention() {
  const canReadInvoices = useCan('read:invoices')
  const vat = useVatReturnDue()
  const closing = useMonthsToClose()
  const legalForm = useLegalFormMissing()
  const invoices = useQuery({ ...invoiceListQuery(ATTENTION), enabled: canReadInvoices })
  const rows = (invoices.data?.data ?? []).slice(0, 6)
  const months = closing.value ?? []
  const pending =
    vat.pending || closing.pending || (canReadInvoices && !invoices.data && !invoices.error)
  const empty = !vat.value && months.length === 0 && !legalForm && rows.length === 0

  return (
    <DashboardCard
      title={translate('needsAttention')}
      icon={ListTodo}
      tone="warning"
      help={translate('needsAttentionHelp')}
      viewAll={
        canReadInvoices
          ? {
              href: '/invoices?status=open&status=refund_due&kind=invoice',
              label: translate('allThatNeedsAttention').trim(),
            }
          : undefined
      }
      className="min-w-0 flex-[5_1_340px]"
    >
      {vat.error && (
        <SourceError
          message={translate('theVATReturnCouldnTBeChecked')}
          error={vat.error}
          retry={translate('retryVATReturn')}
          onRetry={vat.retry}
        />
      )}
      {closing.error && (
        <SourceError
          message={translate('closingCouldnTBeChecked')}
          error={closing.error}
          retry={translate('retryClosing')}
          onRetry={closing.retry}
        />
      )}
      {invoices.error && (
        <SourceError
          message={translate('openInvoicesCouldnTBeLoaded')}
          error={invoices.error}
          retry={translate('retryInvoices')}
          onRetry={() => void invoices.refetch()}
        />
      )}
      {pending ? (
        <Loader className="min-h-72" />
      ) : empty ? (
        !vat.error &&
        !closing.error &&
        !invoices.error && (
          <EmptyState
            icon={CircleCheck}
            title={translate('allDoneNothingNeedsYourAttention')}
            description={translate('nothingNeedsAttentionBody')}
            className="my-auto"
          />
        )
      ) : (
        <ul className="grid px-1.5 pb-2">
          {vat.value && (
            <TaskRow
              href="/books/vat-return"
              icon={Landmark}
              tone="warning"
              title={translate('vatReturnPeriod', { period: vat.value.period })}
              detail={dueLabel(vat.value.due)}
              side={formatDate(vat.value.due)}
            />
          )}
          {months.length > 0 && (
            <TaskRow
              href="/books"
              icon={Lock}
              tone="info"
              title={translate('monthsAreReadyToClose', {
                months: list.format(months.map(monthLabel)),
                length: months.length,
              })}
              detail={translate('closeTheMonth', { length: months.length })}
            />
          )}
          {legalForm && (
            <TaskRow
              href="/settings/company?focus=seller.legal_form#company"
              icon={Building2}
              tone="brand"
              title={translate('addYourCompanysLegalForm')}
              detail={translate('legalFormMissingBody')}
            />
          )}
          {rows.map((row) => (
            <li key={row.id}>
              <RecordLink href={`/invoices?id=${encodeURIComponent(row.id)}`} className={LIST_ROW}>
                <span className="flex min-w-0 items-center gap-3">
                  <Initials name={row.client.name} className="size-9 text-xs" />
                  <span className="grid min-w-0 gap-0.5 leading-tight">
                    <span className="truncate">{row.client.name}</span>
                    <span className="truncate text-body-sm text-muted-foreground">
                      <span className="font-code">{row.number}</span> ·{' '}
                      {isPositive(row.refund_due)
                        ? translate('toRefund')
                        : dueLabel(row.due_date).toLowerCase()}
                    </span>
                  </span>
                </span>
                <Money
                  value={isPositive(row.refund_due) ? row.refund_due : row.amount_due}
                  currency={row.currency}
                  className="ml-auto text-right"
                />
                <span className="w-[76px] shrink-0 text-right @max-sm:hidden">
                  <RowStatus invoice={row} />
                </span>
              </RecordLink>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  )
}

/** A to-do from the books: a tinted icon where invoices show initials, a title, a hint, a link. */
function TaskRow({
  href,
  icon,
  tone,
  title,
  detail,
  side,
}: {
  href: string
  icon: LucideIcon
  tone: Tone
  title: string
  detail: string
  side?: string
}) {
  return (
    <li>
      <Link href={href} className={LIST_ROW}>
        <span className="flex min-w-0 items-center gap-3">
          <ToneTile icon={icon} tone={tone} />
          <span className="grid min-w-0 gap-0.5 leading-tight">
            <span className="truncate">{title}</span>
            <span className="truncate text-body-sm text-muted-foreground">{detail}</span>
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-body-sm text-muted-foreground">
          {side}
          <ArrowRight aria-hidden className="size-4 stroke-[1.5]" />
        </span>
      </Link>
    </li>
  )
}

/** One source of the list failed: say which, offer a retry, and keep showing the others. */
function SourceError({
  message,
  error,
  retry,
  onRetry,
}: {
  message: string
  error: Error
  retry: string
  onRetry: () => void
}) {
  return (
    <div className="mx-4 mb-2 grid justify-items-start gap-3 rounded-lg bg-muted/50 p-3">
      <p role="alert" className="text-sm text-muted-foreground">
        {message}
        {errorMessage(error)}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retry}
      </Button>
    </div>
  )
}

const PERIODS = [
  { value: '30d', label: translate('message30d') },
  { value: '90d', label: translate('message90d') },
  { value: '12m', label: translate('message12m') },
] as const

const chartConfig = {
  income: { label: translate('income2'), color: 'var(--chart-1)' },
  expenses: { label: translate('expenses'), color: 'var(--chart-2)' },
} satisfies ChartConfig

const tickDate = (period: string) => (iso: string) =>
  new Date(iso).toLocaleDateString(
    languageTag,
    period === '12m' ? { month: 'short' } : { day: 'numeric', month: 'short' },
  )
const compact = new Intl.NumberFormat(languageTag, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * Money in against money out. A year is bars per month, so a quiet year with one busy month still
 * reads month by month; 30 and 90 days are an income area over a dashed expenses line.
 */
function CashFlow() {
  const canReadInvoices = useCan('read:invoices')
  const canReadExpenses = useCan('read:expenses')
  const [currency, setCurrency] = useState<string>()
  const dashboard = useDashboard(currency)
  const [currencies, setCurrencies] = useState<string[]>([])
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('12m')
  const availableCurrencies = dashboard.data?.currencies ?? currencies
  const points = dashboard.data?.cash_flow[period] ?? []
  const income = points.reduce((sum, point) => sum + point.income, 0)
  const expenses = points.reduce((sum, point) => sum + point.expenses, 0)
  const unit = dashboard.data?.currency ?? currency ?? '—'

  return (
    <DashboardCard
      title={translate('cashFlow')}
      icon={ChartSpline}
      help={translate('cashFlowHelp')}
      className="min-w-0 flex-[7_1_480px]"
      actions={
        <>
          {availableCurrencies.length > 1 && (
            <NativeSelect
              aria-label={translate('cashFlowCurrency')}
              value={dashboard.data?.currency ?? currency}
              onChange={(event) => {
                setCurrencies(availableCurrencies)
                setCurrency(event.target.value)
              }}
            >
              {availableCurrencies.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          )}
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <output
            aria-label={translate('netCashFlow')}
            className="flex items-baseline gap-1.5 text-display leading-none tracking-[-0.02em] tabular-nums"
          >
            <span className="text-body-sm tracking-normal text-muted-foreground">{unit}</span>
            {dashboard.data ? formatWhole(income - expenses) : '—'}
            <span className="text-body-sm tracking-normal text-muted-foreground">
              {translate('net')}
            </span>
          </output>
          <p className="flex flex-wrap items-center gap-2 text-body-sm">
            <LegendChip swatch="bg-(--chart-1)" label={translate('income2')}>
              {dashboard.data && `${unit} ${formatWhole(income)}`}
            </LegendChip>
            <LegendChip
              swatch="border-t-2 border-dashed border-(--chart-2) bg-transparent"
              label={translate('expenses')}
            >
              {dashboard.data && `${unit} ${formatWhole(expenses)}`}
            </LegendChip>
          </p>
        </div>
        {(!canReadInvoices || !canReadExpenses) && (
          <p className="text-xs text-muted-foreground">
            {canReadInvoices
              ? translate('invoicePaymentsAndRefundsOnlyExpensesAreNotIncluded')
              : translate('paidExpensesOnlyInvoicePaymentsAndRefundsAreNot')}
          </p>
        )}
        {dashboard.error ? (
          <div className="grid h-60 content-center justify-items-start gap-3">
            <p role="alert" className="text-sm text-muted-foreground">
              {translate('cashFlowCouldnTBeLoaded')}
              {errorMessage(dashboard.error)}
            </p>
            <Button size="sm" variant="outline" onClick={() => void dashboard.refetch()}>
              {translate('retryCashFlow')}
            </Button>
          </div>
        ) : dashboard.data ? (
          <ChartContainer config={chartConfig} className="mt-auto aspect-auto h-60 w-full">
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
                    fillOpacity={0.55}
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
          <Loader className="min-h-60" />
        )}
      </div>
    </DashboardCard>
  )
}

/** A legend entry as a soft chip: the series' swatch, its name and its total. */
function LegendChip({
  swatch,
  label,
  children,
}: {
  swatch: string
  label: string
  children?: string | false
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1">
      <span aria-hidden className={`h-0.5 w-3.5 rounded-full ${swatch}`} />
      <span>{label}</span>
      {children && <span className="text-muted-foreground tabular-nums">{children}</span>}
    </span>
  )
}
