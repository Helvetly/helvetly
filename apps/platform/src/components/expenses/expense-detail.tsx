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
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BookCheck, Ban, Copy, Ellipsis, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
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
import { categoryLabel } from '@/lib/expense-categories'
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

import { ExpenseReceipts, RECEIPT_INPUT_ID } from './expense-receipts'

export type ExpenseCommand =
  | 'edit'
  | 'book'
  | 'duplicate'
  | 'void'
  | 'delete'
  | 'mark_paid'
  | 'mark_unpaid'
  | 'mark_reimbursed'

/** A titled block with hairline rows. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  )
}

function Row({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex min-h-10 items-baseline justify-between gap-4 py-2 text-[14px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 text-right break-words', muted && 'text-muted-foreground')}>
        {value}
      </span>
    </div>
  )
}

const day = (date: string | null) => (date ? formatDay(date) : '—')

/** One expense in a 680px drawer from the right (full screen on phones). */
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
        className="w-full! max-w-none! gap-0 overflow-y-auto p-0 sm:w-[min(680px,100vw)]! dark:bg-card"
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
  const method = PAYMENT_METHODS.find((entry) => entry.value === expense.payment_method)?.label
  const subtitle = [
    expense.category && categoryLabel(expense.category),
    expense.document_date && formatDay(expense.document_date),
  ]
    .filter(Boolean)
    .join(' · ')

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
          {gated ? (
            <ApprovalGate target={target} approval={approval}>
              <BookCheck className="size-3.5" />
              {translate('book')}
            </ApprovalGate>
          ) : (
            draft && (
              <Button
                className="cursor-pointer gap-1.5"
                disabled={!expense.is_complete}
                title={
                  expense.is_complete ? undefined : translate('completeTheMissingDetailsFirst')
                }
                onClick={() => onCommand('book', expense)}
              >
                <BookCheck className="size-3.5" />
                {translate('book')}
              </Button>
            )
          )}
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
          <h3 className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            {translate('receipt')}
          </h3>
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

        <Block title={translate('amounts')}>
          {expense.lines.map((line) => (
            <Row
              key={line.id}
              label={translate('vat', {
                value1: line.description ?? translate('line', { position: line.position }),
                vat_rate: line.vat_rate,
              })}
              value={<span className="tabular-nums">{money(line.amount)}</span>}
            />
          ))}
          <Row
            label={translate('net2')}
            value={<span className="tabular-nums">{money(expense.net_total)}</span>}
          />
          {expense.vat_breakdown
            .filter((group) => group.rate !== '0')
            .map((group) => (
              <Row
                key={group.rate}
                label={translate('vatOn', {
                  rate: group.rate,
                  value2: money(group.taxable_amount),
                })}
                value={<span className="tabular-nums">{money(group.vat_amount)}</span>}
              />
            ))}
          <Row
            label={translate('total')}
            value={<span className="font-medium tabular-nums">{money(expense.total)}</span>}
          />
          <Row
            label={translate('reclaimableInputTax', {
              value1:
                expense.input_tax === 'partial'
                  ? `${expense.deductible_percent}%`
                  : expense.input_tax,
            })}
            value={
              <span className="text-success tabular-nums">{base(expense.base.deductible_vat)}</span>
            }
          />
          {isForeignVat(expense.supplier_country) && expense.vat_total !== '0.00' && (
            <p className="py-2 text-[13px] text-muted-foreground">
              {translate('chargedIn')}
              {expense.supplier_country}. {FOREIGN_VAT_HINT}
            </p>
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
                  RATE_SOURCES.find((source) => source.value === expense.exchange_rate_source)
                    ?.label,
                  expense.exchange_rate_date && formatDay(expense.exchange_rate_date),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No date or source yet'
              }
            />
          )}
        </Block>

        <Block title={translate('details')}>
          <Row
            label={translate('category')}
            value={
              expense.category ? (
                <span>
                  {categoryLabel(expense.category)}{' '}
                  <span className="text-muted-foreground tabular-nums">
                    {expense.category.account_code}
                  </span>
                </span>
              ) : (
                '—'
              )
            }
          />
          <Row label={translate('receiptDate')} value={day(expense.document_date)} />
          {expense.due_date && <Row label={translate('due')} value={day(expense.due_date)} />}
          {expense.reference && (
            <Row label={translate('invoiceReceiptNo')} value={expense.reference} />
          )}
          {expense.supplier_vat_number && (
            <Row
              label={translate('supplierVATUID')}
              value={<span className="font-code">{expense.supplier_vat_number}</span>}
            />
          )}
          {expense.description && <Row label={translate('whatFor')} value={expense.description} />}
        </Block>

        <Block title={translate('payment')}>
          <Row
            label={translate('status')}
            value={
              expense.payment_status === 'paid'
                ? `Paid ${expense.paid_on ? formatDay(expense.paid_on) : ''}${method ? ` · ${method}` : ''}`
                : expense.is_overdue
                  ? `Overdue since ${day(expense.due_date)}`
                  : 'Not paid yet'
            }
          />
          {expense.paid_by_member && (
            <Row
              label={translate('paidOutOfPocketBy')}
              value={`${expense.paid_by_member.name}${
                expense.reimbursed_on
                  ? ` · reimbursed ${formatDay(expense.reimbursed_on)}`
                  : ' · to reimburse'
              }`}
            />
          )}
        </Block>

        {expense.note && (
          <Block title={translate('note')}>
            <p className="py-2 text-[14px] leading-relaxed whitespace-pre-wrap">{expense.note}</p>
          </Block>
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
    </div>
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
