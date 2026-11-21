'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  BookCheck,
  Ban,
  Check,
  Copy,
  Ellipsis,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import {
  ApprovalGate,
  ApprovalPanel,
  awaitsApproval,
  showsApproval,
} from '@/components/approvals/approval-panel'
import { inputClass } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { ApprovalBadge } from '@/components/invoices/invoice-bits'
import { RecordPageButton } from '@/components/record-link'
import { useApproval } from '@/lib/approvals'
import { useFolders, type Folder } from '@/lib/documents'
import {
  expenseState,
  FOREIGN_VAT_HINT,
  isForeignVat,
  MISSING_LABELS,
  RATE_SOURCES,
  useExpense,
  type Expense,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { formatDay, formatMoney, PAYMENT_METHODS } from '@/lib/invoices'
import { folderLabel } from '@/lib/system-folders'

import { postingPreview } from './expense-postings'
import { ExpenseReceipts, RECEIPT_INPUT_ID } from './expense-receipts'
import { ExpenseReread } from './expense-reread'
import { useReceiptAIBlock } from './expense-start'

export type ExpenseCommand =
  | 'edit'
  | 'book'
  | 'duplicate'
  | 'void'
  | 'delete'
  | 'mark_paid'
  | 'mark_unpaid'
  | 'mark_reimbursed'

/** A label and its value on one line of a card. */
function Row({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex min-h-8 items-baseline justify-between gap-4 py-1 text-body-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 text-right break-words', muted && 'text-muted-foreground')}>
        {value}
      </span>
    </div>
  )
}

const day = (date: string | null) => (date ? formatDay(date) : '—')

/** One expense in a 760px drawer from the right (full screen on phones). */
export function ExpenseDetail({
  id,
  canManage,
  onClose,
  onCommand,
}: {
  id: string
  canManage: boolean
  onClose: () => void
  onCommand: (command: ExpenseCommand, expense: Expense) => void
}) {
  const query = useExpense(id)
  const expense = query.data
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto p-0 sm:w-[min(760px,100vw)]! dark:bg-card"
      >
        <SheetTitle className="sr-only">
          {expense ? translate('expense3', { number: expense.number }) : translate('expense2')}
        </SheetTitle>
        <SheetDescription className="sr-only">{translate('expenseDetails')}</SheetDescription>
        {expense ? (
          <Detail expense={expense} canManage={canManage} onClose={onClose} onCommand={onCommand} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-[15px]">{translate('thisExpenseCouldnTBeOpened')}</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, translate('thisExpense'))}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => void query.refetch()}
              >
                {translate('tryAgain')}
              </Button>
              <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onClose}>
                {translate('close')}
              </Button>
            </div>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({
  expense,
  canManage,
  onClose,
  onCommand,
}: {
  expense: Expense
  canManage: boolean
  onClose: () => void
  onCommand: (command: ExpenseCommand, expense: Expense) => void
}) {
  const badge = expenseState(expense)
  const draft = expense.status === 'draft'
  const target = { doc: 'expenses', id: expense.id } as const
  const approval = useApproval(target, draft).data
  // Booking waits for the draft's approval when the policy asks for one; missing details come first.
  const gated = draft && expense.is_complete && awaitsApproval(approval)
  const foreign = expense.currency !== expense.base.currency
  const money = (value: string) => formatMoney(value, expense.currency)
  const base = (value: string) => formatMoney(value, expense.base.currency)
  const [rereading, setRereading] = useState(false)
  const aiBlock = useReceiptAIBlock()
  const rereadable = draft && expense.receipts_count > 0
  const subtitle = [
    expense.category?.name,
    expense.document_date && formatDay(expense.document_date),
  ]
    .filter(Boolean)
    .join(' · ')

  if (rereading) return <ExpenseReread expense={expense} onDone={() => setRereading(false)} />

  const book = gated ? (
    <ApprovalGate target={target} approval={approval}>
      <BookCheck className="size-3.5" />
      {translate('book')}
    </ApprovalGate>
  ) : (
    draft && (
      <Button
        className="cursor-pointer gap-1.5"
        disabled={!expense.is_complete}
        title={expense.is_complete ? undefined : translate('completeTheMissingDetailsFirst')}
        onClick={() => onCommand('book', expense)}
      >
        <BookCheck className="size-3.5" />
        {translate('book')}
      </Button>
    )
  )

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-border/60 bg-card/95 px-3 backdrop-blur">
        <Badge size="sm" className="font-code ml-1">
          #{expense.number}
        </Badge>
        <span className="ml-1.5 text-[13px] text-muted-foreground">{translate('expense2')}</span>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('moreActions')}
                className="cursor-pointer"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {rereadable && (
                <DropdownMenuItem
                  className="cursor-pointer"
                  disabled={aiBlock !== null}
                  title={aiBlock ?? undefined}
                  onSelect={() => setRereading(true)}
                >
                  <HeidiSparkle />
                  {translate('readAgainWithAI')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => onCommand('duplicate', expense)}
              >
                <Copy />
                {translate('duplicate')}
              </DropdownMenuItem>
              {expense.status === 'booked' && canManage && (
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer"
                  onSelect={() => onCommand('void', expense)}
                >
                  <Ban />
                  {translate('void')}
                </DropdownMenuItem>
              )}
              {draft && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="cursor-pointer"
                    onSelect={() => onCommand('delete', expense)}
                  >
                    <Trash2 />
                    {translate('deleteDraft')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {expense.status !== 'void' && (
            <Button
              variant="outline"
              className="cursor-pointer gap-1.5"
              onClick={() => onCommand('edit', expense)}
            >
              <Pencil className="size-3.5" />
              {translate('edit4')}
            </Button>
          )}
          <span className="hidden sm:contents">{book}</span>
          <RecordPageButton />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={translate('close')}
            className="cursor-pointer"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="grid gap-7 px-6 pt-6 pb-8">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {draft && <ApprovalBadge state={expense.approval_state} />}
            {expense.paid_by_member && !expense.reimbursed_on && expense.status !== 'void' && (
              <Badge tone="blue">{translate('toReimburse')}</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
            <h2 className="min-w-0 text-[22px] leading-tight font-medium tracking-[-0.02em] break-words">
              {expense.supplier_name ?? (
                <span className="text-muted-foreground">{translate('noSupplierYet')}</span>
              )}
            </h2>
            <p className="text-[24px] leading-tight font-medium tracking-[-0.02em] whitespace-nowrap tabular-nums">
              {money(expense.total)}
            </p>
          </div>
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-[13.5px] text-muted-foreground">
            <span>{subtitle || expense.description || translate('noCategoryOrDateYet')}</span>
            {foreign && <span className="tabular-nums">{base(expense.base.total)}</span>}
          </div>
        </div>

        {draft && !expense.is_complete && (
          <Callout tone="warning" title={translate('notReadyToBook')}>
            <p className="text-muted-foreground">{translate('notReadyToBookHint')}</p>
            <ul aria-label={translate('missing').trim()} className="mt-1.5 flex flex-wrap gap-1.5">
              {expense.missing_fields.map((field) => (
                <li key={field}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() =>
                      field === 'receipt'
                        ? document.getElementById(RECEIPT_INPUT_ID)?.click()
                        : onCommand('edit', expense)
                    }
                  >
                    {field === 'receipt' ? <Upload /> : <Plus />}
                    {MISSING_LABELS[field]}
                  </Button>
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {showsApproval(approval) && <ApprovalPanel target={target} approval={approval} />}
        {expense.status === 'void' && (
          <div className="grid gap-0.5 rounded-xl px-4 py-3 ring-1 ring-border">
            <p className="text-[14px] font-medium">
              {translate('voided')}
              {expense.voided_at && formatDate(expense.voided_at)}
              {expense.voided_by && translate('dynamicBy', { name: expense.voided_by.name })}
            </p>
            {expense.void_reason && (
              <p className="text-[13px] text-muted-foreground">{expense.void_reason}</p>
            )}
          </div>
        )}

        <section className="grid gap-2">
          <div className="flex min-h-8 items-center justify-between gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {translate('receipt')}
            </h3>
            {rereadable && (
              <Button
                variant="ai"
                size="sm"
                disabled={aiBlock !== null}
                title={aiBlock ?? undefined}
                className="cursor-pointer"
                onClick={() => setRereading(true)}
              >
                <HeidiSparkle />
                {translate('readAgainWithAI')}
              </Button>
            )}
          </div>
          <ExpenseReceipts
            expenseId={expense.id}
            editable={draft}
            uploadable={expense.status !== 'void'}
          />
          {expense.receipt_missing_reason && (
            <p className="text-[13px] text-muted-foreground">
              {translate('substituteReceipt')}
              {expense.receipt_missing_reason}
            </p>
          )}
        </section>

        <AmountCard expense={expense} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SupplierCard expense={expense} />
          <PaymentCard expense={expense} />
        </div>
        <BookingCard expense={expense} />

        {expense.note && (
          <Panel title={translate('note')}>
            <p className="text-body-sm leading-relaxed whitespace-pre-wrap">{expense.note}</p>
          </Panel>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          {translate('created5')}
          {formatDate(expense.created_at)}
          {expense.created_by && translate('dynamicBy', { name: expense.created_by.name })}
          {expense.booked_at && translate('booked', { value1: formatDate(expense.booked_at) })}
          {expense.booked_by && translate('dynamicBy', { name: expense.booked_by.name })}
          {translate('bookedExpensesAndTheirReceiptsAreKeptFor10')}
        </p>
      </div>
      {draft && (
        <div className="sticky bottom-0 flex justify-end border-t border-border/60 bg-card/95 px-4 py-3 backdrop-blur sm:hidden [&>*]:w-full">
          {book}
        </div>
      )}
    </div>
  )
}

const UNCATEGORISED_FOLDER = 'Uncategorised'

const gross = (group: Expense['vat_breakdown'][number]) =>
  (Number(group.taxable_amount) + Number(group.vat_amount)).toFixed(2)

/** The amounts by VAT rate, what can be reclaimed, the items and the exchange rate. */
function AmountCard({ expense }: { expense: Expense }) {
  const money = (value: string) => formatMoney(value, expense.currency)
  const base = (value: string) => formatMoney(value, expense.base.currency)
  const foreign = expense.currency !== expense.base.currency
  const deductible = expense.base.deductible_vat !== '0.00'
  const items = expense.entry_mode === 'itemised' || expense.lines.some((line) => line.description)
  return (
    <Panel title={translate('amounts')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xl font-medium tabular-nums">{money(expense.total)}</p>
        {foreign && (
          <p className="text-body-sm text-muted-foreground tabular-nums">
            ≈ {base(expense.base.total)}
          </p>
        )}
      </div>
      <table className="mt-3 w-full text-body-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">{translate('detailRate')}</th>
            <th className="py-1 text-right font-normal">{translate('detailNet')}</th>
            <th className="py-1 text-right font-normal">{translate('detailVat')}</th>
            <th className="py-1 text-right font-normal">{translate('detailGross')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {expense.vat_breakdown.map((group) => (
            <tr key={group.rate}>
              <td className="py-1.5">{group.rate}%</td>
              <td className="py-1.5 text-right">{money(group.taxable_amount)}</td>
              <td className="py-1.5 text-right">{money(group.vat_amount)}</td>
              <td className="py-1.5 text-right">{money(gross(group))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        className={cn(
          'mt-3 flex items-center gap-1.5 text-body-sm',
          deductible ? 'text-success' : 'text-muted-foreground',
        )}
      >
        {deductible && <Check className="size-4 shrink-0" />}
        {deductible
          ? translate('reclaimInputTax', { amount: base(expense.base.deductible_vat) })
          : translate('noInputTaxReclaimed')}
        {expense.input_tax === 'partial' &&
          ` · ${translate('partlyReclaimable', { percent: expense.deductible_percent })}`}
      </p>
      {isForeignVat(expense.supplier_country) && expense.vat_total !== '0.00' && (
        <p className="mt-1 text-xs text-muted-foreground">
          {translate('chargedIn')}
          {expense.supplier_country}. {FOREIGN_VAT_HINT}
        </p>
      )}
      {items && (
        <ul
          aria-label={translate('itemsCount', { count: expense.lines.length })}
          className="mt-3 grid gap-1 border-t border-border/60 pt-3"
        >
          {expense.lines.map((line) => (
            <li key={line.id} className="flex items-baseline gap-2 text-body-sm">
              <span className="min-w-0 flex-1 break-words">
                {line.description ?? translate('line', { position: line.position })}
                {line.category && (
                  <Badge size="sm" tone="neutral" className="ml-2">
                    {line.category.name}
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{line.vat_rate}%</span>
              <span className="tabular-nums">{money(line.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {foreign && (
        <Row
          label={translate('rate', {
            exchange_rate: expense.exchange_rate,
            currency: expense.base.currency,
            value3: expense.currency,
          })}
          muted
          value={
            [
              RATE_SOURCES.find((source) => source.value === expense.exchange_rate_source)?.label,
              expense.exchange_rate_date && formatDay(expense.exchange_rate_date),
            ]
              .filter(Boolean)
              .join(' · ') || translate('noDateOrSourceYet')
          }
        />
      )}
    </Panel>
  )
}

function SupplierCard({ expense }: { expense: Expense }) {
  return (
    <Panel title={translate('supplierAndDocument')}>
      <p className="text-body font-medium break-words">
        {expense.supplier_name ?? <span className="text-muted-foreground">—</span>}
      </p>
      {expense.supplier_vat_number && (
        <p className="font-code text-xs text-muted-foreground">{expense.supplier_vat_number}</p>
      )}
      <div className="mt-2 divide-y divide-border/60">
        <Row label={translate('supplierCountry')} value={expense.supplier_country} />
        {expense.reference && (
          <Row label={translate('invoiceReceiptNo')} value={expense.reference} />
        )}
        <Row label={translate('receiptDate')} value={day(expense.document_date)} />
        {expense.description && <Row label={translate('whatFor')} value={expense.description} />}
      </div>
    </Panel>
  )
}

type Step = { label: string; detail?: string; state: 'done' | 'open' | 'late' }

/** From the receipt's date to the payment (and the payback of what a member paid), as a short timeline. */
function PaymentCard({ expense }: { expense: Expense }) {
  const method = PAYMENT_METHODS.find((entry) => entry.value === expense.payment_method)?.label
  const paid = expense.payment_status === 'paid'
  const steps: Step[] = [
    { label: translate('timelineDated'), detail: day(expense.document_date), state: 'done' },
  ]
  if (expense.due_date && !paid)
    steps.push({
      label: expense.is_overdue
        ? translate('overdueSince', { date: formatDay(expense.due_date) })
        : translate('timelineDue', { date: formatDay(expense.due_date) }),
      state: expense.is_overdue ? 'late' : 'open',
    })
  steps.push(
    paid
      ? {
          label: translate('paidOnDate', { date: day(expense.paid_on) }),
          detail: method,
          state: 'done',
        }
      : { label: translate('notPaidYet'), state: 'open' },
  )
  if (expense.paid_by_member)
    steps.push(
      expense.reimbursed_on
        ? {
            label: translate('reimbursedOnDate', { date: formatDay(expense.reimbursed_on) }),
            detail: expense.paid_by_member.name,
            state: 'done',
          }
        : {
            label: translate('toReimburse'),
            detail: translate('paidOutOfPocketByName', { name: expense.paid_by_member.name }),
            state: 'open',
          },
    )
  return (
    <Panel title={translate('payment')}>
      <ol className="grid">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="relative grid grid-cols-[auto_1fr] gap-x-3 pb-3 last:pb-0"
          >
            {index < steps.length - 1 && (
              <span aria-hidden className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border" />
            )}
            <span
              aria-hidden
              className={cn(
                'mt-1.5 size-2.5 rounded-full ring-2 ring-card',
                step.state === 'done' && 'bg-success-solid',
                step.state === 'open' && 'bg-card ring-1 ring-border',
                step.state === 'late' && 'bg-destructive',
              )}
            />
            <span className="grid text-body-sm">
              <span className={cn(step.state === 'late' && 'text-destructive')}>{step.label}</span>
              {step.detail && <span className="text-xs text-muted-foreground">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/** Expenses/<category>/<year> as far as it exists, from the folder list; null while unknown or not readable. */
function useExpenseFolder(expense: Expense): Folder[] | null {
  const all = useFolders().data
  const root = all?.find((folder) => folder.system_kind === 'expenses' && !folder.parent_id)
  if (!all || !root) return null
  const name = expense.category?.name ?? UNCATEGORISED_FOLDER
  const category = all.find(
    (folder) =>
      folder.parent_id === root.id &&
      folder.system_kind === 'expense_category' &&
      folder.name === name,
  )
  const year =
    category &&
    expense.document_date &&
    all.find(
      (folder) =>
        folder.parent_id === category.id && folder.name === expense.document_date?.slice(0, 4),
    )
  return [root, category, year].filter((folder): folder is Folder => Boolean(folder))
}

/** The account it books to, the entries (a preview while a draft) and the folder its receipts are filed in. */
function BookingCard({ expense }: { expense: Expense }) {
  const postings = postingPreview(expense)
  const folder = useExpenseFolder(expense) ?? []
  const last = folder.at(-1)
  const amount = (value: string) => formatMoney(value, expense.base.currency)
  return (
    <Panel
      title={translate('bookingCard')}
      action={
        last && (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={`/documents?${new URLSearchParams({ folder: last.id })}`}>
              <FolderOpen />
              <span className="max-w-56 truncate">
                {folder.map((entry) => folderLabel(entry)).join(' / ')}
              </span>
            </Link>
          </Button>
        )
      }
    >
      <p className="text-body-sm">
        {expense.category ? (
          <>
            {expense.category.name}{' '}
            <span className="text-muted-foreground tabular-nums">
              {expense.category.account_code}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{translate('chooseCategoryForEntries')}</span>
        )}
      </p>
      {postings.length > 0 && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {expense.status === 'draft'
              ? translate('bookingPreviewHint')
              : translate('bookingEntriesHint')}
          </p>
          <table className="mt-1 w-full text-body-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-normal">{translate('debit')}</th>
                <th className="py-1 text-left font-normal">{translate('ledgerCredit')}</th>
                <th className="py-1 text-right font-normal">{translate('amountColumn')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {postings.map((posting) => (
                <tr key={`${posting.debit}-${posting.credit}-${posting.amount}`}>
                  <td className="py-1.5">{posting.debit}</td>
                  <td className="py-1.5">{posting.credit}</td>
                  <td className="py-1.5 text-right">{amount(posting.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  )
}

/** Voiding needs a reason, kept with the expense. */
export function VoidDialog({
  expense,
  pending,
  onClose,
  onVoid,
}: {
  expense: Expense
  pending: boolean
  onClose: () => void
  onVoid: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(420px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-6">
        <DialogTitle className="text-[17px] font-medium">
          {translate('voidExpense2')}
          {expense.number}?
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-[14px] leading-relaxed">
          {translate('itStaysInYourRecordsMarkedVoidAndNo')}
        </DialogDescription>
        <form
          className="mt-4 grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!reason.trim()) return setError(translate('sayWhyItIsVoided'))
            onVoid(reason.trim())
          }}
        >
          <label
            htmlFor="void-reason"
            className={cn('text-[13px] font-medium', error && 'text-destructive')}
          >
            {translate('reason')}
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
          </label>
          <textarea
            id="void-reason"
            rows={3}
            maxLength={500}
            value={reason}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setReason(event.target.value)
              setError('')
            }}
            placeholder={translate('eGEnteredTwiceTheAmountWasWrong')}
            className={cn(inputClass, 'h-auto resize-y py-2')}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              size="xl"
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={onClose}
            >
              {translate('keepIt')}
            </Button>
            <Button
              size="xl"
              type="submit"
              variant="destructive"
              disabled={pending}
              className="cursor-pointer"
            >
              <Ban /> {pending ? translate('voiding') : translate('voidExpense')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
