'use client'

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

import { NativeSelect } from '@/components/clients/fields'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
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
  ['banana', 'Banana'],
  ['bexio', 'bexio'],
  ['abacus', 'Abacus'],
  ['csv', 'CSV'],
] as const

const PARTS = [
  { value: 'year', label: 'Whole year' },
  ...[1, 2, 3, 4].map((q) => ({ value: `Q${q}`, label: `Quarter ${q}` })),
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: new Date(Date.UTC(2000, i, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' }),
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
  self_billed: 'self-billed invoice',
  no_category: 'expense without a category',
}

const ACCOUNT_FIELDS: { key: Exclude<keyof LedgerAccounts, 'bank'>; label: string }[] = [
  { key: 'receivables', label: 'Receivables' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'output_vat', label: 'Output VAT' },
  { key: 'rounding', label: 'Rounding' },
  { key: 'payables', label: 'Payables' },
  { key: 'member_payable', label: 'Owed to members' },
  { key: 'input_vat_material', label: 'Input VAT, materials and services' },
  { key: 'input_vat_other', label: 'Input VAT, investments and other costs' },
]

const RETENTION_YEARS = 10 // GeBüV: books are kept ten years

export function LedgerPage() {
  const thisYear = Number(today(undefined, useSession().data?.workspace.timezone).slice(0, 4))
  const [picked, setYear] = useState<number>()
  const year = picked ?? thisYear
  const [part, setPart] = useState('year')
  const [open, setOpen] = useState<LedgerBalance | null>(null)
  const [accounts, setAccounts] = useState(false)
  const { from, to } = rangeOf(year, part)
  const report = useQuery({ queryKey: ['ledger', from, to], queryFn: () => fetchLedger(from, to) })
  const data = report.data
  const none = !data || data.balances.length === 0

  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title="Ledger"
        description="The trial balance (Saldenliste) from issued invoices, payments and booked expenses. Click an account for its general ledger (Hauptbuch)."
      >
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="Year"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            wrapperClassName="w-24"
          >
            {Array.from({ length: RETENTION_YEARS + 1 }, (_, i) => thisYear - i).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Period"
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
                <Download /> Export <ChevronDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {FORMATS.map(([format, label]) => (
                <DropdownMenuItem key={format} asChild>
                  <a href={ledgerExportUrl(format, from, to)} download>
                    {label}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="lg" onClick={() => setAccounts(true)}>
            <ListTree /> Accounts
          </Button>
        </div>
        {data && data.unposted.length > 0 && (
          <Callout
            tone="warning"
            icon={TriangleAlert}
            title={`${data.unposted.length} ${data.unposted.length === 1 ? 'document is' : 'documents are'} not in the ledger`}
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
              title="Nothing in the ledger for this period"
              description="Issue an invoice, record a payment or book an expense and it appears here."
            />
          </section>
        ) : (
          <section className={card} aria-label="Saldenliste">
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-border/60 text-caption text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">Account</th>
                    <th className="px-4 py-2.5 text-left font-medium">Name</th>
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
            Hauptbuch, {formatDate(from)} – {formatDate(to)} · {currency}
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
                    Opening balance
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
                    Closing balance
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
          <SheetTitle className="text-body font-medium">Accounts</SheetTitle>
          <SheetDescription className="text-body-sm">
            The chart-of-accounts numbers that invoices, payments and expenses post to.
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
      toast.success('Accounts saved.')
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
      <h3 className="pt-2 text-body font-medium sm:col-span-2">Bank and cash, by payment method</h3>
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
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      ) : (
        <p className="text-body-sm text-muted-foreground">
          Only an owner or admin can change these.
        </p>
      )}
    </form>
  )
}
