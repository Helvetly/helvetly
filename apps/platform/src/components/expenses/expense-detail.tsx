'use client'

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
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BookCheck, Ban, Copy, Ellipsis, Pencil, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { inputClass } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { RecordPageButton } from '@/components/record-link'
import {
  expenseState,
  FOREIGN_VAT_HINT,
  isForeignVat,
  MISSING_LABELS,
  RATE_SOURCES,
  useExpense,
  type Expense,
} from '@/lib/expenses'
import { formatDay, formatMoney, PAYMENT_METHODS } from '@/lib/invoices'

import { ExpenseReceipts } from './expense-receipts'

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
          {expense ? `Expense #${expense.number}` : 'Expense'}
        </SheetTitle>
        <SheetDescription className="sr-only">Expense details</SheetDescription>
        {expense ? (
          <Detail expense={expense} canManage={canManage} onClose={onClose} onCommand={onCommand} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-[15px]">This expense couldn’t be opened.</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, 'This expense')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
              <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onClose}>
                Close
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
  const foreign = expense.currency !== expense.base.currency
  const money = (value: string) => formatMoney(value, expense.currency)
  const base = (value: string) => formatMoney(value, expense.base.currency)
  const method = PAYMENT_METHODS.find((entry) => entry.value === expense.payment_method)?.label
  const subtitle = [
    expense.category?.name,
    expense.document_date && formatDay(expense.document_date),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-border/60 bg-card/95 px-3 backdrop-blur">
        <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground tabular-nums">
          #{expense.number}
        </span>
        <span className="ml-1.5 text-[13px] text-muted-foreground">Expense</span>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
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
                <Copy /> Duplicate
              </DropdownMenuItem>
              {expense.status === 'booked' && canManage && (
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer"
                  onSelect={() => onCommand('void', expense)}
                >
                  <Ban /> Void…
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
                    <Trash2 /> Delete draft
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
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
          {draft && (
            <Button
              className="cursor-pointer gap-1.5"
              disabled={!expense.is_complete}
              title={expense.is_complete ? undefined : 'Complete the missing details first'}
              onClick={() => onCommand('book', expense)}
            >
              <BookCheck className="size-3.5" /> Book
            </Button>
          )}
          <RecordPageButton />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
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
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            {expense.paid_by_member && !expense.reimbursed_on && expense.status !== 'void' && (
              <StatusBadge tone="blue">To reimburse</StatusBadge>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
            <h2 className="min-w-0 text-[22px] leading-tight font-medium tracking-[-0.02em] break-words">
              {expense.supplier_name ?? (
                <span className="text-muted-foreground">No supplier yet</span>
              )}
            </h2>
            <p className="text-[24px] leading-tight font-medium tracking-[-0.02em] whitespace-nowrap tabular-nums">
              {money(expense.total)}
            </p>
          </div>
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-[13.5px] text-muted-foreground">
            <span>{subtitle || expense.description || 'No category or date yet'}</span>
            {foreign && <span className="tabular-nums">{base(expense.base.total)}</span>}
          </div>
        </div>

        {draft && !expense.is_complete && (
          <Callout
            tone="warning"
            title="Not ready to book"
            actions={
              <Button className="cursor-pointer" onClick={() => onCommand('edit', expense)}>
                Complete
              </Button>
            }
          >
            <p className="text-muted-foreground">
              Missing: {expense.missing_fields.map((field) => MISSING_LABELS[field]).join(', ')}
            </p>
          </Callout>
        )}
        {expense.status === 'void' && (
          <div className="grid gap-0.5 rounded-xl px-4 py-3 ring-1 ring-border">
            <p className="text-[14px] font-medium">
              Voided {expense.voided_at && formatDate(expense.voided_at)}
              {expense.voided_by && ` by ${expense.voided_by.name}`}
            </p>
            {expense.void_reason && (
              <p className="text-[13px] text-muted-foreground">{expense.void_reason}</p>
            )}
          </div>
        )}

        <section className="grid gap-2">
          <h3 className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            Receipt
          </h3>
          <ExpenseReceipts
            expenseId={expense.id}
            editable={draft}
            uploadable={expense.status !== 'void'}
          />
          {expense.receipt_missing_reason && (
            <p className="text-[13px] text-muted-foreground">
              Substitute receipt: {expense.receipt_missing_reason}
            </p>
          )}
        </section>

        <Block title="Amounts">
          {expense.lines.map((line) => (
            <Row
              key={line.id}
              label={`${line.description ?? `Line ${line.position}`} · ${line.vat_rate}% VAT`}
              value={<span className="tabular-nums">{money(line.amount)}</span>}
            />
          ))}
          <Row
            label="Net"
            value={<span className="tabular-nums">{money(expense.net_total)}</span>}
          />
          {expense.vat_breakdown
            .filter((group) => group.rate !== '0')
            .map((group) => (
              <Row
                key={group.rate}
                label={`VAT ${group.rate}% on ${money(group.taxable_amount)}`}
                value={<span className="tabular-nums">{money(group.vat_amount)}</span>}
              />
            ))}
          <Row
            label="Total"
            value={<span className="font-medium tabular-nums">{money(expense.total)}</span>}
          />
          <Row
            label={`Reclaimable input tax (${
              expense.input_tax === 'partial' ? `${expense.deductible_percent}%` : expense.input_tax
            })`}
            value={
              <span className="text-success tabular-nums">{base(expense.base.deductible_vat)}</span>
            }
          />
          {isForeignVat(expense.supplier_country) && expense.vat_total !== '0.00' && (
            <p className="py-2 text-[13px] text-muted-foreground">
              Charged in {expense.supplier_country}. {FOREIGN_VAT_HINT}
            </p>
          )}
          {foreign && (
            <Row
              label={`Rate ${expense.exchange_rate} ${expense.base.currency}/${expense.currency}`}
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

        <Block title="Details">
          <Row
            label="Category"
            value={
              expense.category ? (
                <span>
                  {expense.category.name}{' '}
                  <span className="text-muted-foreground tabular-nums">
                    {expense.category.account_code}
                  </span>
                </span>
              ) : (
                '—'
              )
            }
          />
          <Row label="Receipt date" value={day(expense.document_date)} />
          {expense.due_date && <Row label="Due" value={day(expense.due_date)} />}
          {expense.reference && <Row label="Invoice / receipt no." value={expense.reference} />}
          {expense.supplier_vat_number && (
            <Row
              label="Supplier VAT / UID"
              value={<span className="font-mono text-[13px]">{expense.supplier_vat_number}</span>}
            />
          )}
          {expense.description && <Row label="What for" value={expense.description} />}
        </Block>

        <Block title="Payment">
          <Row
            label="Status"
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
              label="Paid out of pocket by"
              value={`${expense.paid_by_member.name}${
                expense.reimbursed_on
                  ? ` · reimbursed ${formatDay(expense.reimbursed_on)}`
                  : ' · to reimburse'
              }`}
            />
          )}
        </Block>

        {expense.note && (
          <Block title="Note">
            <p className="py-2 text-[14px] leading-relaxed whitespace-pre-wrap">{expense.note}</p>
          </Block>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Created {formatDate(expense.created_at)}
          {expense.created_by && ` by ${expense.created_by.name}`}
          {expense.booked_at && ` · Booked ${formatDate(expense.booked_at)}`}
          {expense.booked_by && ` by ${expense.booked_by.name}`}. Booked expenses and their receipts
          are kept for 10 years.
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
          Void expense #{expense.number}?
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-[14px] leading-relaxed">
          It stays in your records, marked void, and no longer counts. Duplicate it to book a
          corrected copy.
        </DialogDescription>
        <form
          className="mt-4 grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!reason.trim()) return setError('Say why it is voided.')
            onVoid(reason.trim())
          }}
        >
          <label
            htmlFor="void-reason"
            className={cn('text-[13px] font-medium', error && 'text-destructive')}
          >
            Reason
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
            placeholder="e.g. Entered twice; the amount was wrong"
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
              Keep it
            </Button>
            <Button
              size="xl"
              type="submit"
              variant="destructive"
              disabled={pending}
              className="cursor-pointer"
            >
              <Ban /> {pending ? 'Voiding…' : 'Void expense'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
