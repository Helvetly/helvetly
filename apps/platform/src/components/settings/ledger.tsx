'use client'
import { languageTag, localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Landmark,
  ListTree,
  Receipt,
  ShoppingCart,
  TriangleAlert,
  X,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { FeatureLockNotice, useFeatureLock } from '@/components/billing/feature-lock'
import { BooksHeader } from '@/components/books/books-tabs'
import { inputClass, NativeSelect } from '@/components/clients/fields'
import { ariaSort, SortButton } from '@/components/data/sort-header'
import { FormSection } from '@/components/form-section'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatAmount, PAYMENT_METHODS, today } from '@/lib/invoices'
import {
  balanceSortValue,
  DEFAULT_SORT,
  fetchLedger,
  fetchLedgerSettings,
  fetchStatement,
  ledgerExportUrl,
  saveLedgerSettings,
  SORT_FIELDS,
  type LedgerAccounts,
  type LedgerBalance,
  type SortField,
} from '@/lib/ledger'
import { nextSort, parseSort, sortParam, sortRows, type Sort } from '@/lib/list-sort'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import { setUrlQuery } from '@/lib/url-query'

import { SettingsPage } from './layout'

const card = 'min-w-0 rounded-xl border border-border bg-card'
const money = 'text-right whitespace-nowrap tabular-nums'
const th = 'px-4 py-2.5 text-caption font-medium text-muted-foreground'

const FORMATS = [
  ['banana', translate('banana')],
  ['bexio', 'bexio'],
  ['abacus', translate('abacus')],
  ['csv', 'CSV'],
] as const

const QUARTERS = [1, 2, 3, 4].map((q) => ({
  value: `Q${q}`,
  label: translate('quarter', { q: q }),
}))
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: new Date(Date.UTC(2000, i, 1)).toLocaleString(languageTag, {
    month: 'long',
    timeZone: 'UTC',
  }),
}))

const pad = (n: number) => String(n).padStart(2, '0')

/** The first and last day of a year, a quarter ("Q2") or a month ("03"). */
export function rangeOf(year: number, part: string) {
  const [first, last] =
    part === 'year' ? [1, 12] : part.startsWith('Q') ? quarter(part) : month(part)
  const end = new Date(Date.UTC(year, last, 0)).getUTCDate()
  return { from: `${year}-${pad(first)}-01`, to: `${year}-${pad(last)}-${pad(end)}` }
}
const quarter = (part: string): [number, number] => {
  const q = Number(part.slice(1))
  return [q * 3 - 2, q * 3]
}
const month = (part: string): [number, number] => [Number(part), Number(part)]

/** The account classes of the Swiss SME chart (Kontenrahmen KMU), by an account's first digit. */
const CLASSES: Record<string, string> = {
  '1': translate('assets'),
  '2': translate('liabilitiesAndEquity'),
  '3': translate('operatingRevenue'),
  '4': translate('materialAndGoodsExpense'),
  '5': translate('personnelExpense'),
  '6': translate('otherOperatingExpenses'),
  '7': translate('ancillaryOperations'),
  '8': translate('nonOperatingAndExtraordinary'),
  '9': translate('yearEndClosing'),
}

/** Balances under their account class, in chart order; the rows of a class in `sort` order. */
export function groupByClass(balances: LedgerBalance[], sort: Sort<SortField> = DEFAULT_SORT) {
  const groups = new Map<string, LedgerBalance[]>()
  for (const row of balances.toSorted((a, b) => a.account.localeCompare(b.account))) {
    const key = row.account.charAt(0)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups].map(([key, rows]) => ({
    key,
    name: CLASSES[key] ?? '',
    rows: sortRows(rows, (row) => balanceSortValue(row, sort.field), sort.desc),
  }))
}

/** The sum of decimal amounts, in cents so that 0.1 + 0.2 stays 0.30. */
export function sumAmounts(values: string[]) {
  const cents = values.reduce((total, value) => total + Math.round(Number(value) * 100), 0)
  return (cents / 100).toFixed(2)
}

const isZero = (value: string) => Number(value) === 0

/** An amount, with a quiet dash for zero so the figures that matter stand out. */
function Amount({ value }: { value: string }) {
  return isZero(value) ? (
    <span className="text-muted-foreground/50">–</span>
  ) : (
    <>{formatAmount(value)}</>
  )
}

const REASONS: Record<string, string> = {
  self_billed: translate('selfBilledInvoice'),
  no_category: translate('expenseWithoutACategory'),
}

const RETENTION_YEARS = 10 // GeBüV: books are kept ten years

const DESCRIPTION = translate('theTrialBalanceSaldenlisteFromIssuedInvoicesPaymentsAnd')

export function LedgerPage() {
  const thisYear = Number(today(undefined, useSession().data?.workspace.timezone).slice(0, 4))
  const [picked, setYear] = useState<number>()
  const year = picked ?? thisYear
  const [part, setPart] = useState('year')
  const [open, setOpen] = useState<LedgerBalance | null>(null)
  const [accounts, setAccounts] = useState(false)
  const { from, to } = rangeOf(year, part)
  const lock = useFeatureLock('ledger_exports')
  const report = useQuery({
    queryKey: ['ledger', from, to],
    queryFn: () => fetchLedger(from, to),
    enabled: !lock,
  })
  const data = report.data
  const none = !data || data.balances.length === 0

  if (lock)
    return (
      <>
        <BooksHeader />
        <SettingsPage title={translate('ledger')} description={DESCRIPTION}>
          <FeatureLockNotice
            lock={lock}
            kept={translate('yourInvoicesPaymentsAndExpensesStayAsThey')}
          />
        </SettingsPage>
      </>
    )

  return (
    <>
      <BooksHeader />
      <SettingsPage title={translate('ledger')} description={DESCRIPTION}>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={translate('year')}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            wrapperClassName="w-24"
          >
            {Array.from({ length: RETENTION_YEARS + 1 }, (_, i) => thisYear - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={translate('period')}
            value={part}
            onChange={(event) => setPart(event.target.value)}
            wrapperClassName="w-40"
          >
            <option value="year">{translate('wholeYear')}</option>
            {[
              [translate('quarters'), QUARTERS],
              [translate('months'), MONTHS],
            ].map(([label, options]) => (
              <optgroup key={String(label)} label={String(label)}>
                {(options as typeof MONTHS).map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="lg" disabled={none}>
                <Download />
                {translate('export2')}
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {FORMATS.map(([format, label]) => (
                <DropdownMenuItem key={format} asChild>
                  <a href={localizedHref(ledgerExportUrl(format, from, to))} download>
                    {label}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="lg" onClick={() => setAccounts(true)}>
            <ListTree />
            {translate('accounts2')}
          </Button>
        </div>
        {data && data.unposted.length > 0 && (
          <Callout
            tone="warning"
            icon={TriangleAlert}
            title={translate('notInTheLedger', {
              length: data.unposted.length,
              value2:
                data.unposted.length === 1 ? translate('documentIs') : translate('documentsAre'),
            })}
          >
            <ul className="grid gap-0.5">
              {data.unposted.map((item) => (
                <li key={item.ref}>
                  {item.ref}: {REASONS[item.reason] ?? item.reason}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {report.error ? (
          <p className="text-body text-muted-foreground">{errorMessage(report.error)}</p>
        ) : !data ? (
          <Loader className="min-h-96" />
        ) : data.balances.length === 0 ? (
          <section className={card}>
            <EmptyState
              icon={BookOpen}
              title={translate('nothingInTheLedgerForThisPeriod')}
              description={translate('issueAnInvoiceRecordAPaymentOrBookAn')}
            />
          </section>
        ) : (
          <TrialBalance balances={data.balances} currency={data.currency} onOpen={setOpen} />
        )}
      </SettingsPage>
      {open && data && (
        <StatementDrawer
          balance={open}
          names={new Map(data.balances.map((row) => [row.account, row.name]))}
          from={from}
          to={to}
          onClose={() => setOpen(null)}
        />
      )}
      {accounts && <AccountsDrawer onClose={() => setAccounts(false)} />}
    </>
  )
}

/**
 * The Saldenliste under the classes of the chart of accounts, each class with its closing subtotal, and a
 * total row that shows whether debits and credits agree.
 */
function TrialBalance({
  balances,
  currency,
  onOpen,
}: {
  balances: LedgerBalance[]
  currency: string
  onOpen: (row: LedgerBalance) => void
}) {
  const pathname = usePathname()
  const query = useSearchParams()
  const sort = parseSort(query.get('sort'), SORT_FIELDS, DEFAULT_SORT)
  const sortBy = (field: SortField) => {
    const next = new URLSearchParams(query)
    const value = sortParam(
      nextSort(sort, field, field !== 'account' && field !== 'name'),
      DEFAULT_SORT,
    )
    if (value) next.set('sort', value)
    else next.delete('sort')
    setUrlQuery(pathname, next)
  }
  const head = (field: SortField, label: string, align: string) => (
    <th aria-sort={ariaSort(sort.field === field, sort.desc)} className={`${th} ${align}`}>
      <SortButton
        label={label}
        sorted={sort.field === field}
        desc={sort.desc}
        onClick={() => sortBy(field)}
      />
    </th>
  )
  // Only the books' own currency adds up; a foreign-currency account is listed with its badge.
  const own = balances.filter((row) => row.currency === currency)
  const debit = sumAmounts(own.map((row) => row.debit))
  const credit = sumAmounts(own.map((row) => row.credit))
  const difference = sumAmounts([debit, `-${credit}`])
  return (
    <section className={card} aria-label={translate('saldenliste')}>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-border/60">
              {head('account', translate('account'), 'w-24 text-left')}
              {head('name', translate('name'), 'text-left')}
              {head('opening', translate('opening'), money)}
              {head('debit', translate('debit'), money)}
              {head('credit', translate('credit2'), money)}
              {head('closing', translate('closing'), money)}
              <th className="w-10" aria-hidden />
            </tr>
          </thead>
          {groupByClass(balances, sort).map((group) => (
            <tbody key={group.key} className="border-b border-border/60 last:border-0">
              <tr className="bg-muted/40">
                <th
                  scope="rowgroup"
                  colSpan={5}
                  className="px-4 py-2 text-left text-caption font-medium text-muted-foreground"
                >
                  <span className="mr-2 tabular-nums">{group.key}</span>
                  {group.name}
                </th>
                <td className={`px-4 py-2 text-caption font-medium text-muted-foreground ${money}`}>
                  <Amount
                    value={sumAmounts(
                      group.rows.filter((row) => row.currency === currency).map((r) => r.closing),
                    )}
                  />
                </td>
                <td aria-hidden />
              </tr>
              {group.rows.map((row) => (
                <tr
                  key={`${row.account}-${row.currency}`}
                  onClick={() => onOpen(row)}
                  className="group/row cursor-pointer border-t border-border/40 transition-colors hover:bg-muted/40"
                >
                  <td className="font-code px-4 py-2.5">
                    <button
                      type="button"
                      className="rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`${row.account} ${row.name}`}
                    >
                      {row.account}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    {row.name}
                    {row.currency !== currency && (
                      <Badge size="sm" className="ml-2">
                        {row.currency}
                      </Badge>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 ${money}`}>
                    <Amount value={row.opening} />
                  </td>
                  <td className={`px-4 py-2.5 ${money}`}>
                    <Amount value={row.debit} />
                  </td>
                  <td className={`px-4 py-2.5 ${money}`}>
                    <Amount value={row.credit} />
                  </td>
                  <td className={`px-4 py-2.5 font-medium ${money}`}>
                    <Amount value={row.closing} />
                  </td>
                  <td className="pr-3 text-muted-foreground/60 group-hover/row:text-foreground">
                    <ChevronRight aria-hidden className="size-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t border-border font-medium">
              <th scope="row" colSpan={3} className="px-4 py-3 text-left">
                {translate('total')} · {currency}
              </th>
              <td className={`px-4 py-3 ${money}`}>{formatAmount(debit)}</td>
              <td className={`px-4 py-3 ${money}`}>{formatAmount(credit)}</td>
              <td className="px-4 py-3 text-right" colSpan={2}>
                {isZero(difference) ? (
                  <Badge tone="green" size="sm">
                    <Check aria-hidden className="mr-1 size-3" />
                    {translate('debitsEqualCredits')}
                  </Badge>
                ) : (
                  <Badge tone="amber" size="sm">
                    {translate('offBy', { value1: formatAmount(difference) })}
                  </Badge>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

/** Wide enough for the seven columns of an account statement without a sideways scroll. */
const wideDrawer = 'w-full! max-w-none! gap-0 p-0 sm:w-[min(1040px,calc(100vw-6rem))]! dark:bg-card'
const formDrawer = 'w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card'

function DrawerHeader({
  title,
  description,
  onClose,
}: {
  title: string
  description: string
  onClose: () => void
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-8">
      <div className="grid min-w-0 gap-0.5">
        <SheetTitle className="truncate text-lg font-semibold">{title}</SheetTitle>
        <SheetDescription className="text-body-sm text-muted-foreground">
          {description}
        </SheetDescription>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={translate('close')}
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/50 px-3 py-2.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className={cn('text-body tabular-nums', strong && 'font-semibold')}>
        {formatAmount(value)}
      </span>
    </div>
  )
}

function StatementDrawer({
  balance,
  names,
  from,
  to,
  onClose,
}: {
  balance: LedgerBalance
  /** Account names by code, for the contra account of each line. */
  names: Map<string, string>
  from: string
  to: string
  onClose: () => void
}) {
  const { account, currency } = balance
  const statement = useQuery({
    queryKey: ['ledger', 'statement', account, currency, from, to],
    queryFn: () => fetchStatement(account, currency, from, to),
  })
  const s = statement.data
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" showCloseButton={false} className={wideDrawer}>
        <DrawerHeader
          title={`${account} ${balance.name}`}
          description={`${translate('hauptbuch')}${formatDate(from)} – ${formatDate(to)} · ${currency}`}
          onClose={onClose}
        />
        {statement.error ? (
          <p className="p-5 text-body text-muted-foreground md:px-8">
            {errorMessage(statement.error)}
          </p>
        ) : !s ? (
          <Loader className="flex-1" />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid grid-cols-2 gap-2 px-5 pt-5 sm:grid-cols-4 md:px-8">
              <Figure label={translate('openingBalance')} value={s.opening} />
              <Figure
                label={translate('debit')}
                value={sumAmounts(s.lines.map((line) => line.debit))}
              />
              <Figure
                label={translate('credit2')}
                value={sumAmounts(s.lines.map((line) => line.credit))}
              />
              <Figure label={translate('closingBalance')} value={s.closing} strong />
            </div>
            <div className="px-5 py-5 md:px-8">
              <div className={cn(card, 'overflow-x-auto')}>
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className={`${th} text-left`}>{translate('date')}</th>
                      <th className={`${th} text-left`}>{translate('reference')}</th>
                      <th className={`${th} text-left`}>{translate('description')}</th>
                      <th className={`${th} text-left`}>{translate('contraAccount')}</th>
                      <th className={`${th} ${money}`}>{translate('debit')}</th>
                      <th className={`${th} ${money}`}>{translate('credit2')}</th>
                      <th className={`${th} ${money}`}>{translate('balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-muted/40 text-muted-foreground">
                      <td className="px-4 py-2" colSpan={6}>
                        {translate('openingBalance')}
                      </td>
                      <td className={`px-4 py-2 ${money}`}>{formatAmount(s.opening)}</td>
                    </tr>
                    {s.lines.length === 0 && (
                      <tr className="border-t border-border/40">
                        <td className="px-4 py-6 text-center text-muted-foreground" colSpan={7}>
                          {translate('noBookingsInThisPeriod')}
                        </td>
                      </tr>
                    )}
                    {s.lines.map((line) => (
                      <tr
                        key={`${line.date}-${line.ref}-${line.contra}-${line.debit}-${line.credit}`}
                        className="border-t border-border/40"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(line.date)}</td>
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap">{line.ref}</td>
                        <td className="min-w-48 px-4 py-2.5">{line.description}</td>
                        <td className="px-4 py-2.5">
                          <span className="grid leading-tight">
                            <span className="tabular-nums">{line.contra}</span>
                            {names.get(line.contra) && (
                              <span className="max-w-48 truncate text-caption text-muted-foreground">
                                {names.get(line.contra)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 ${money}`}>
                          <Amount value={line.debit} />
                        </td>
                        <td className={`px-4 py-2.5 ${money}`}>
                          <Amount value={line.credit} />
                        </td>
                        <td className={`px-4 py-2.5 ${money}`}>{formatAmount(line.balance)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border bg-muted/40 font-medium">
                      <td className="px-4 py-2.5" colSpan={6}>
                        {translate('closingBalance')}
                      </td>
                      <td className={`px-4 py-2.5 ${money}`}>{formatAmount(s.closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

type AccountKey = Exclude<keyof LedgerAccounts, 'bank'>

/** The posting accounts by what they are for, each with what posts to it. */
const SECTIONS: {
  icon: typeof Receipt
  title: string
  description: string
  fields: { key: AccountKey; label: string; tip: string }[]
}[] = [
  {
    icon: Receipt,
    title: translate('sales'),
    description: translate('whereIssuedInvoicesAndTheirVATArePosted'),
    fields: [
      {
        key: 'receivables',
        label: translate('receivables'),
        tip: translate('anIssuedInvoiceWaitsHereUntilItIsPaid'),
      },
      {
        key: 'revenue',
        label: translate('revenue'),
        tip: translate('theNetAmountOfEveryIssuedInvoice'),
      },
      {
        key: 'output_vat',
        label: translate('outputVAT'),
        tip: translate('theVATYouChargeOnInvoicesAndOweTheTaxOffice'),
      },
      {
        key: 'rounding',
        label: translate('rounding'),
        tip: translate('roundingToTheNearest5Centimes'),
      },
    ],
  },
  {
    icon: ShoppingCart,
    title: translate('purchases'),
    description: translate('whereBookedExpensesAndTheirVATArePosted'),
    fields: [
      {
        key: 'payables',
        label: translate('payables'),
        tip: translate('aSupplierBillWaitsHereUntilItIsPaid'),
      },
      {
        key: 'member_payable',
        label: translate('owedToMembers'),
        tip: translate('anExpenseAMemberPaidFromTheirOwnPocket'),
      },
      {
        key: 'input_vat_material',
        label: translate('inputVATMaterialsAndServices'),
        tip: translate('vATOnPurchasesYouCanReclaimMaterialsAndServices'),
      },
      {
        key: 'input_vat_other',
        label: translate('inputVATInvestmentsAndOtherCosts'),
        tip: translate('vATOnPurchasesYouCanReclaimInvestmentsAndOther'),
      },
    ],
  },
]

const CODE = /^\d{3,10}$/

/** A message for each account code that is not 3 to 10 digits, keyed as the API keys them. */
export function validateAccounts(draft: LedgerAccounts): FieldErrors {
  const errors: FieldErrors = {}
  const message = translate('enterAnAccountCodeOf3To10Digits')
  for (const section of SECTIONS)
    for (const { key } of section.fields) if (!CODE.test(draft[key])) errors[key] = message
  for (const [method, code] of Object.entries(draft.bank))
    if (!CODE.test(code)) errors[`bank.${method}`] = message
  return errors
}

const methodLabel = (method: string) =>
  PAYMENT_METHODS.find((entry) => entry.value === method)?.label ??
  method.charAt(0).toUpperCase() + method.slice(1).replaceAll('_', ' ')

const fieldId = (key: string) => `ledger-${key.replace('.', '-')}`

function CodeField({
  id,
  label,
  tip,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string
  label: string
  tip?: string
  value: string
  error?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <FormField id={fieldId(id)} label={label} tip={tip} error={error} required>
      <input
        id={fieldId(id)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId(id)}-error` : undefined}
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.trim())}
        className={cn(inputClass, 'tabular-nums')}
      />
    </FormField>
  )
}

function AccountsDrawer({ onClose }: { onClose: () => void }) {
  const canEdit = useCan('write:ledger')
  const settings = useQuery({ queryKey: ['ledger', 'settings'], queryFn: fetchLedgerSettings })
  return settings.data ? (
    <AccountsForm initial={settings.data} canEdit={canEdit} onClose={onClose} />
  ) : (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" showCloseButton={false} className={formDrawer}>
        <DrawerHeader
          title={translate('accounts')}
          description={translate('theChartOfAccountsNumbersThatInvoicesPaymentsAnd')}
          onClose={onClose}
        />
        {settings.error ? (
          <p className="p-5 text-body text-muted-foreground md:px-8">
            {errorMessage(settings.error)}
          </p>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Focuses the first field with an error, in the form's order. */
function focusFirst(found: FieldErrors) {
  document
    .querySelector<HTMLElement>(
      Object.keys(found)
        .map((key) => `#${fieldId(key)}`)
        .join(','),
    )
    ?.focus()
}

function AccountsForm({
  initial,
  canEdit,
  onClose,
}: {
  initial: LedgerAccounts
  canEdit: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [discarding, setDiscarding] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const save = useMutation({
    mutationFn: () => saveLedgerSettings(draft),
    onSuccess: async (data) => {
      queryClient.setQueryData(['ledger', 'settings'], data)
      await queryClient.invalidateQueries({ queryKey: ['ledger'] })
      toast.success(translate('accountsSaved'))
      onClose()
    },
    onError: (error) => {
      const fields = apiFieldErrors(error)
      if (fields) {
        setErrors(fields)
        focusFirst(fields)
      } else toast.error(errorMessage(error))
    },
  })
  const set = (key: string, value: string) => {
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)))
    setDraft(
      key.startsWith('bank.')
        ? { ...draft, bank: { ...draft.bank, [key.slice(5)]: value } }
        : { ...draft, [key]: value },
    )
  }
  const requestClose = () => {
    if (save.isPending) return
    if (dirty) setDiscarding(true)
    else onClose()
  }
  const disabled = !canEdit || save.isPending

  return (
    <Sheet open onOpenChange={(next) => !next && requestClose()}>
      <SheetContent side="right" showCloseButton={false} className={formDrawer}>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            const found = validateAccounts(draft)
            setErrors(found)
            if (Object.keys(found).length) return focusFirst(found)
            save.mutate()
          }}
        >
          <DrawerHeader
            title={translate('accounts')}
            description={translate('theChartOfAccountsNumbersThatInvoicesPaymentsAnd')}
            onClose={requestClose}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {SECTIONS.map((section) => (
              <FormSection
                key={section.title}
                icon={section.icon}
                title={section.title}
                description={section.description}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  {section.fields.map(({ key, label, tip }) => (
                    <CodeField
                      key={key}
                      id={key}
                      label={label}
                      tip={tip}
                      value={draft[key]}
                      error={errors[key]}
                      disabled={disabled}
                      onChange={(value) => set(key, value)}
                    />
                  ))}
                </div>
              </FormSection>
            ))}
            <FormSection
              icon={Landmark}
              title={translate('bankAndCash')}
              description={translate('whereAPaymentLandsByHowItWasPaid')}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {Object.entries(draft.bank).map(([method, code]) => (
                  <CodeField
                    key={method}
                    id={`bank.${method}`}
                    label={methodLabel(method)}
                    value={code}
                    error={errors[`bank.${method}`]}
                    disabled={disabled}
                    onChange={(value) => set(`bank.${method}`, value)}
                  />
                ))}
              </div>
            </FormSection>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
            {canEdit ? (
              <>
                <Button type="button" variant="ghost" className="ml-auto" onClick={requestClose}>
                  {translate('cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? translate('saving') : translate('saveChanges')}
                </Button>
              </>
            ) : (
              <p className="text-body-sm text-muted-foreground">
                {translate('viewOnlyAskAnOwnerOrAdminForEditAccess')}
              </p>
            )}
          </div>
          {discarding && (
            <ConfirmDialog
              title={translate('discardYourChanges')}
              body={translate('whatYouEnteredInThisFormWillBeLost')}
              confirmLabel={translate('discard')}
              cancelLabel={translate('keepEditing')}
              tone="destructive"
              onDecide={(discard) => {
                setDiscarding(false)
                if (discard) onClose()
              }}
            />
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}
