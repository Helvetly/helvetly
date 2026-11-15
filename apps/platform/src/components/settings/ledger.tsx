'use client'
import { languageTag, localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronDown, Download, ListTree, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { FeatureLockNotice, useFeatureLock } from '@/components/billing/feature-lock'
import { NativeSelect } from '@/components/clients/fields'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { formatAmount, today } from '@/lib/invoices'
import {
  fetchLedger,
  fetchLedgerSettings,
  fetchStatement,
  ledgerExportUrl,
  saveLedgerSettings,
  type LedgerAccounts,
  type LedgerBalance,
} from '@/lib/ledger'
import { useSession } from '@/lib/queries'

import { SettingsPage } from './layout'
import { isManager, SettingsHeader } from './settings-tabs'

const card = 'min-w-0 rounded-xl border border-border'
const money = 'text-right whitespace-nowrap tabular-nums'

const FORMATS = [
  ['banana', translate('banana')],
  ['bexio', 'bexio'],
  ['abacus', translate('abacus')],
  ['csv', 'CSV'],
] as const

const PARTS = [
  { value: 'year', label: translate('wholeYear') },
  ...[1, 2, 3, 4].map((q) => ({ value: `Q${q}`, label: translate('quarter', { q: q }) })),
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: new Date(Date.UTC(2000, i, 1)).toLocaleString(languageTag, {
      month: 'long',
      timeZone: 'UTC',
    }),
  })),
]

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

const REASONS: Record<string, string> = {
  self_billed: translate('selfBilledInvoice'),
  no_category: translate('expenseWithoutACategory'),
}

const ACCOUNT_FIELDS: { key: Exclude<keyof LedgerAccounts, 'bank'>; label: string }[] = [
  { key: 'receivables', label: translate('receivables') },
  { key: 'revenue', label: translate('revenue') },
  { key: 'output_vat', label: translate('outputVAT') },
  { key: 'rounding', label: translate('rounding') },
  { key: 'payables', label: translate('payables') },
  { key: 'member_payable', label: translate('owedToMembers') },
  { key: 'input_vat_material', label: translate('inputVATMaterialsAndServices') },
  { key: 'input_vat_other', label: translate('inputVATInvestmentsAndOtherCosts') },
]

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
        <SettingsHeader />
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
      <SettingsHeader />
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
            wrapperClassName="w-36"
          >
            {PARTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
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
          <section className={card} aria-label={translate('saldenliste')}>
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-border/60 text-caption text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">{translate('account')}</th>
                    <th className="px-4 py-2.5 text-left font-medium">{translate('name')}</th>
                    {['Opening', 'Debit', 'Credit', 'Closing'].map((h) => (
                      <th key={h} className={`px-4 py-2.5 font-medium ${money}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map((row) => (
                    <tr
                      key={`${row.account}-${row.currency}`}
                      onClick={() => setOpen(row)}
                      className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-2 tabular-nums">
                        <button type="button" className="font-medium">
                          {row.account}
                        </button>
                      </td>
                      <td className="px-4 py-2">
                        {row.name}
                        {row.currency !== data.currency && (
                          <Badge variant="secondary" className="ml-2 text-muted-foreground">
                            {row.currency}
                          </Badge>
                        )}
                      </td>
                      <td className={`px-4 py-2 ${money}`}>{formatAmount(row.opening)}</td>
                      <td className={`px-4 py-2 ${money}`}>{formatAmount(row.debit)}</td>
                      <td className={`px-4 py-2 ${money}`}>{formatAmount(row.credit)}</td>
                      <td className={`px-4 py-2 font-medium ${money}`}>
                        {formatAmount(row.closing)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </SettingsPage>
      {open && <StatementDrawer balance={open} from={from} to={to} onClose={() => setOpen(null)} />}
      {accounts && <AccountsDrawer onClose={() => setAccounts(false)} />}
    </>
  )
}

const drawer = 'w-full! max-w-none! gap-0 bg-card p-0 sm:w-[min(720px,100vw)]!'

function StatementDrawer({
  balance,
  from,
  to,
  onClose,
}: {
  balance: LedgerBalance
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
      <SheetContent side="right" className={drawer}>
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="text-body font-medium">
            {account} {balance.name}
          </SheetTitle>
          <SheetDescription className="text-body-sm">
            {translate('hauptbuch')}
            {formatDate(from)} – {formatDate(to)} · {currency}
          </SheetDescription>
        </SheetHeader>
        {statement.error ? (
          <p className="p-4 text-body text-muted-foreground">{errorMessage(statement.error)}</p>
        ) : !s ? (
          <Loader className="flex-1" />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-border/60 text-caption text-muted-foreground">
                  {['Date', 'Ref', 'Description', 'Contra'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium">
                      {h}
                    </th>
                  ))}
                  {['Debit', 'Credit', 'Balance'].map((h) => (
                    <th key={h} className={`px-4 py-2.5 font-medium ${money}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <td className="px-4 py-2" colSpan={6}>
                    {translate('openingBalance')}
                  </td>
                  <td className={`px-4 py-2 ${money}`}>{formatAmount(s.opening)}</td>
                </tr>
                {s.lines.map((line) => (
                  <tr
                    key={`${line.date}-${line.ref}-${line.contra}-${line.debit}-${line.credit}`}
                    className="border-b border-border/40"
                  >
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(line.date)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{line.ref}</td>
                    <td className="px-4 py-2">{line.description}</td>
                    <td className="px-4 py-2 tabular-nums">{line.contra}</td>
                    <td className={`px-4 py-2 ${money}`}>{formatAmount(line.debit)}</td>
                    <td className={`px-4 py-2 ${money}`}>{formatAmount(line.credit)}</td>
                    <td className={`px-4 py-2 ${money}`}>{formatAmount(line.balance)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-4 py-2" colSpan={6}>
                    {translate('closingBalance')}
                  </td>
                  <td className={`px-4 py-2 ${money}`}>{formatAmount(s.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** "bank transfer" → "Bank transfer": payment methods are keys, labels start with a capital. */
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function CodeField({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  error?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <FormField id={id} label={label} error={error}>
      <Input
        {...describedBy(id, error)}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="tabular-nums"
      />
    </FormField>
  )
}

function AccountsDrawer({ onClose }: { onClose: () => void }) {
  const manager = isManager(useSession().data?.role)
  const settings = useQuery({ queryKey: ['ledger', 'settings'], queryFn: fetchLedgerSettings })
  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className={drawer}>
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="text-body font-medium">{translate('accounts')}</SheetTitle>
          <SheetDescription className="text-body-sm">
            {translate('theChartOfAccountsNumbersThatInvoicesPaymentsAnd')}
          </SheetDescription>
        </SheetHeader>
        {settings.error ? (
          <p className="p-4 text-body text-muted-foreground">{errorMessage(settings.error)}</p>
        ) : settings.data ? (
          <AccountsForm initial={settings.data} manager={manager} onClose={onClose} />
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function AccountsForm({
  initial,
  manager,
  onClose,
}: {
  initial: LedgerAccounts
  manager: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
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
      if (fields) setErrors(fields)
      else toast.error(errorMessage(error))
    },
  })
  return (
    <form
      className="grid content-start gap-x-4 gap-y-5 overflow-auto p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault()
        setErrors({})
        save.mutate()
      }}
    >
      {ACCOUNT_FIELDS.map(({ key, label }) => (
        <CodeField
          key={key}
          id={`ledger-${key}`}
          label={label}
          value={draft[key]}
          error={errors[key]}
          disabled={!manager || save.isPending}
          onChange={(value) => setDraft({ ...draft, [key]: value })}
        />
      ))}
      <h3 className="pt-2 text-body font-medium sm:col-span-2">
        {translate('bankAndCashByPaymentMethod')}
      </h3>
      {Object.entries(draft.bank).map(([method, code]) => (
        <CodeField
          key={method}
          id={`ledger-bank-${method}`}
          label={sentenceCase(method.replaceAll('_', ' '))}
          value={code}
          error={errors[`bank.${method}`]}
          disabled={!manager || save.isPending}
          onChange={(value) => setDraft({ ...draft, bank: { ...draft.bank, [method]: value } })}
        />
      ))}
      {manager ? (
        <Button
          type="submit"
          className="justify-self-start sm:col-span-2"
          disabled={save.isPending}
        >
          {save.isPending ? translate('saving') : translate('save2')}
        </Button>
      ) : (
        <p className="text-body-sm text-muted-foreground">
          {translate('onlyAnOwnerOrAdminCanChangeThese')}
        </p>
      )}
    </form>
  )
}
