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
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { formatDate, formatWhole } from '@helvetly/ui/lib/format'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronDown,
  Landmark,
  LayoutGrid,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { NativeSelect } from '@/components/clients/fields'
import {
  useLegalFormMissing,
  useMonthsToClose,
  useVatReturnDue,
} from '@/components/dashboard/attention'
import { EngagementsCard } from '@/components/engagements/engagements-card'
import { Initials } from '@/components/initials'
import { Money, RowStatus } from '@/components/invoices/invoice-bits'
import { InvoiceKpis } from '@/components/invoices/invoice-kpis'
import { RecordLink } from '@/components/record-link'
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

/** A white section inside the panel's gray area. */
function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card shadow-elevation-1">
      <div className="flex h-12 items-center justify-between gap-3 border-b px-4">
        <h2 className="text-[15px]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Dashboard() {
  const router = useRouter()
  const session = useSession()
  const [period, setPeriod] = useRememberedPeriod()
  const canInvoice = useCan('write:invoices')
  const canReadInvoices = useCan('read:invoices')
  const canReadExpenses = useCan('read:expenses')
  const canReadEngagements = useCan('read:engagements')
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
  return (
    <>
      <PageHeader
        tabs={[translate('dashboard')]}
        tabIcons={[LayoutGrid]}
        primary={canInvoice ? translate('newInvoice') : undefined}
        onPrimary={() => router.push('/invoices/new')}
        actions={canReadInvoices && <PeriodFilter value={period} onChange={setPeriod} />}
      />
      {canReadInvoices && <InvoiceKpis period={period} />}
      <div className="grid flex-1 content-start gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {(canReadInvoices || canReadBooks) && <NeedsAttention />}
        {(canReadInvoices || canReadExpenses) && <CashFlow />}
        {canReadEngagements && <EngagementsCard />}
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
          {range && <span className="truncate text-muted-foreground max-sm:hidden">{range}</span>}
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

const ROW = 'flex h-14 items-center gap-3 px-4 transition-colors duration-150 hover:bg-muted/50'
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
  const rows = (invoices.data?.data ?? []).slice(0, 8)
  const months = closing.value ?? []
  const pending =
    vat.pending || closing.pending || (canReadInvoices && !invoices.data && !invoices.error)
  const empty = !vat.value && months.length === 0 && !legalForm && rows.length === 0

  return (
    <Section
      title={translate('needsAttention')}
      action={
        canReadInvoices && (
          <Button asChild variant="ghost" size="sm" className="font-normal text-muted-foreground">
            <Link href="/invoices?status=open&status=refund_due&kind=invoice">
              {translate('allThatNeedsAttention')}
              <ArrowRight className="stroke-[1.5]" />
            </Link>
          </Button>
        )
      }
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
          <p className="px-4 py-12 text-center text-[14px] text-muted-foreground">
            {translate('allDoneNothingNeedsYourAttention')}
          </p>
        )
      ) : (
        <ul className="py-1.5">
          {vat.value && (
            <TaskRow
              href="/books/vat-return"
              icon={Landmark}
              title={translate('vatReturnPeriod', { period: vat.value.period })}
              detail={dueLabel(vat.value.due)}
              side={formatDate(vat.value.due)}
            />
          )}
          {months.length > 0 && (
            <TaskRow
              href="/books"
              icon={Lock}
              title={translate('monthsAreReadyToClose', {
                months: list.format(months.map(monthLabel)),
                length: months.length,
              })}
              detail={translate('closeTheMonth', { length: months.length })}
            />
          )}
          {legalForm && (
            <TaskRow
              href="/settings/invoices?focus=seller.legal_form#company"
              icon={Building2}
              title={translate('addYourCompanysLegalForm')}
              detail={translate('legalFormMissingBody')}
            />
          )}
          {rows.map((row) => (
            <li key={row.id}>
              <RecordLink href={`/invoices?id=${encodeURIComponent(row.id)}`} className={ROW}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Initials name={row.client.name} />
                  <span className="grid min-w-0 leading-tight">
                    <span className="truncate">{row.client.name}</span>
                    <span className="truncate text-[13px] text-muted-foreground">
                      {row.number} ·{' '}
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
                <span className="w-[72px] text-right">
                  <RowStatus invoice={row} />
                </span>
              </RecordLink>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** A to-do from the books: an icon where invoices show initials, a title, a hint, a link. */
function TaskRow({
  href,
  icon: Icon,
  title,
  detail,
  side,
}: {
  href: string
  icon: LucideIcon
  title: string
  detail: string
  side?: string
}) {
  return (
    <li>
      <Link href={href} className={ROW}>
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border ring-inset"
          >
            <Icon className="size-3.5 stroke-[1.5]" />
          </span>
          <span className="grid min-w-0 leading-tight">
            <span className="truncate">{title}</span>
            <span className="truncate text-body-sm leading-tight text-muted-foreground">
              {detail}
            </span>
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
    <div className="grid justify-items-start gap-3 border-b p-4">
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

function CashFlow() {
  const canReadInvoices = useCan('read:invoices')
  const canReadExpenses = useCan('read:expenses')
  const [currency, setCurrency] = useState<string>()
  const dashboard = useDashboard(currency)
  const [currencies, setCurrencies] = useState<string[]>([])
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('12m')
  const availableCurrencies = dashboard.data?.currencies ?? currencies
  const points = dashboard.data?.cash_flow[period] ?? []
  const net = points.reduce((sum, point) => sum + point.income - point.expenses, 0)

  return (
    <Section
      title={translate('cashFlow')}
      action={
        <div className="flex items-center gap-3">
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
        </div>
      }
    >
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <output
            aria-label={translate('netCashFlow')}
            className="flex items-start gap-1 text-[30px] leading-none tracking-[-0.02em] tabular-nums"
          >
            <span className="mt-1 mr-0.5 text-[13px] tracking-normal text-muted-foreground">
              {dashboard.data?.currency ?? currency ?? '—'}
            </span>
            {dashboard.data ? formatWhole(net) : '—'}
            <span className="mt-0.5 ml-1 text-[11px] tracking-normal text-muted-foreground">
              {translate('net')}
            </span>
          </output>
          <p className="flex items-center gap-4 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-(--chart-1)" />
              {translate('income')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t border-dashed border-(--chart-2)" />
              {translate('expenses2')}
            </span>
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
          <div className="grid h-56 content-center justify-items-start gap-3">
            <p role="alert" className="text-sm text-muted-foreground">
              {translate('cashFlowCouldnTBeLoaded')}
              {errorMessage(dashboard.error)}
            </p>
            <Button size="sm" variant="outline" onClick={() => void dashboard.refetch()}>
              {translate('retryCashFlow')}
            </Button>
          </div>
        ) : dashboard.data ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
            <LineChart data={points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tickMargin={8}
                minTickGap={28}
                tickFormatter={tickDate(period)}
              />
              <YAxis
                width={36}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
              />
              <ChartTooltip
                cursor={{ stroke: 'var(--border)' }}
                content={
                  <ChartTooltipContent
                    className="min-w-40"
                    labelFormatter={(_, payload) => {
                      const date: unknown = payload[0]?.payload?.date
                      return typeof date === 'string' ? formatDate(date) : ''
                    }}
                  />
                }
              />
              <Line
                dataKey="expenses"
                type="monotone"
                stroke="var(--color-expenses)"
                strokeWidth={1.25}
                strokeDasharray="3 3"
                dot={false}
              />
              <Line
                dataKey="income"
                type="monotone"
                stroke="var(--color-income)"
                strokeWidth={1.25}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <Loader className="min-h-56" />
        )}
      </div>
    </Section>
  )
}
