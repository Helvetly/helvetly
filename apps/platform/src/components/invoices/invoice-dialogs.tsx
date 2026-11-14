'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Segmented } from '@helvetly/ui/components/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { inputClass as fieldClass } from '@/components/clients/fields'
import {
  fixActionClass,
  fixCount,
  FixDialog,
  FixLink,
  FixList,
  type Fix,
} from '@/components/fix-list'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import {
  documentName,
  formatMoney,
  MISSING_LABELS,
  parseDecimalInput,
  settingsFix,
  PAYMENT_METHODS,
  today,
  toCents,
  useAddPayment,
  useAddRefund,
  useInvoiceSettings,
  useMarkPaid,
  useSendInvoice,
  type InvoiceListItem,
  type IssueReason,
  type PaymentMethod,
} from '@/lib/invoices'

/** A small form dialog: title, a line of context, the fields, Cancel + the action. */
export function FormDialog({
  title,
  description,
  action,
  pending,
  onSubmit,
  onClose,
  children,
  aside,
}: {
  title: string
  description: ReactNode
  action: string
  pending: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-0 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.25),0_4px_12px_rgb(0_0_0/0.06)]">
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <div className="grid gap-1 px-6 pt-6">
            <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
              {title}
            </DialogTitle>
            <DialogDescription className="text-[13.5px]">{description}</DialogDescription>
          </div>
          <div className="grid gap-4 px-6 pt-5 pb-6">{children}</div>
          <div className="flex items-center gap-2 border-t border-border/70 px-6 py-3">
            {aside}
            <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Working…' : action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export const fieldErrors = (error: unknown): Record<string, string> => {
  if (!(error instanceof ApiError) || error.status !== 422) return {}
  const fields = error.details.fields
  if (typeof fields !== 'object' || fields === null) return {}
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** Records a payment (part or all of what is due), or marks the invoice paid in one go. */
export function PaymentDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem
  onClose: () => void
}) {
  const [amount, setAmount] = useState(invoice.amount_due)
  const [paidOn, setPaidOn] = useState(today())
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const add = useAddPayment()
  const markPaid = useMarkPaid()

  const submit = () => {
    const value = parseDecimalInput(amount, 2, true)
    const found: Record<string, string> = {}
    if (!value || toCents(value) <= 0n) found.amount = 'Enter an amount above 0.'
    else if (toCents(value) > toCents(invoice.amount_due))
      found.amount = `At most ${formatMoney(invoice.amount_due, invoice.currency)} is still due.`
    if (!paidOn) found.paid_on = 'Choose the day it arrived.'
    else if (paidOn > today()) found.paid_on = 'The payment date can’t be in the future.'
    setErrors(found)
    if (Object.keys(found).length || !value) return
    add.mutate(
      {
        id: invoice.id,
        input: {
          amount: value,
          paid_on: paidOn,
          method,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
      {
        onSuccess: (updated) => {
          toast.success(
            updated.status === 'paid'
              ? `${documentName(updated)} is paid in full.`
              : `Payment of ${formatMoney(value, invoice.currency)} recorded.`,
          )
          onClose()
        },
        onError: (error) => {
          const fromServer = fieldErrors(error)
          if (Object.keys(fromServer).length) setErrors(fromServer)
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <FormDialog
      title="Record a payment"
      description={
        <>
          {documentName(invoice)} · {invoice.client.name} ·{' '}
          <span className="text-foreground tabular-nums">
            {formatMoney(invoice.amount_due, invoice.currency)}
          </span>{' '}
          due
        </>
      }
      action="Record payment"
      pending={add.isPending || markPaid.isPending}
      onSubmit={submit}
      onClose={onClose}
      aside={
        <Button
          type="button"
          variant="ghost"
          className="-ml-2.5 text-muted-foreground"
          disabled={markPaid.isPending || add.isPending}
          onClick={() =>
            markPaid.mutate(invoice.id, {
              onSuccess: (updated) => {
                toast.success(`${documentName(updated)} marked as paid.`)
                onClose()
              },
              onError: toastError,
            })
          }
        >
          Mark fully paid today
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField id="payment-amount" label="Amount" required error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-muted-foreground">
              {invoice.currency}
            </span>
            <input
              {...describedBy('payment-amount', errors.amount)}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className={cn(fieldClass, 'pl-12 text-right tabular-nums')}
            />
          </div>
        </FormField>
        <FormField id="payment-date" label="Paid on" required error={errors.paid_on}>
          <input
            {...describedBy('payment-date', errors.paid_on)}
            type="date"
            max={today()}
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            className={cn(fieldClass, 'tabular-nums')}
          />
        </FormField>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Method</span>
        <Segmented
          label="Payment method"
          value={method}
          options={PAYMENT_METHODS}
          onChange={setMethod}
        />
      </div>
      <FormField
        id="payment-note"
        label="Note"
        error={errors.note}
        tip="Only your team sees this, e.g. the bank’s booking text."
      >
        <input
          {...describedBy('payment-note', errors.note)}
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Partial payment, rest in December"
          className={fieldClass}
        />
      </FormField>
    </FormDialog>
  )
}

/** Records money paid back to the customer after a credit note (up to what is owed back). */
export function RefundDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem
  onClose: () => void
}) {
  const [amount, setAmount] = useState(invoice.refund_due)
  const [refundedOn, setRefundedOn] = useState(today())
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const add = useAddRefund()

  const submit = () => {
    const value = parseDecimalInput(amount, 2, true)
    const found: Record<string, string> = {}
    if (!value || toCents(value) <= 0n) found.amount = 'Enter an amount above 0.'
    else if (toCents(value) > toCents(invoice.refund_due))
      found.amount = `At most ${formatMoney(invoice.refund_due, invoice.currency)} is owed back.`
    if (!refundedOn) found.refunded_on = 'Choose the day it was paid back.'
    else if (refundedOn > today()) found.refunded_on = 'The refund date can’t be in the future.'
    setErrors(found)
    if (Object.keys(found).length || !value) return
    add.mutate(
      {
        id: invoice.id,
        input: {
          amount: value,
          refunded_on: refundedOn,
          method,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(`Refund of ${formatMoney(value, invoice.currency)} recorded.`)
          onClose()
        },
        onError: (error) => {
          const fromServer = fieldErrors(error)
          if (Object.keys(fromServer).length) setErrors(fromServer)
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <FormDialog
      title="Record a refund"
      description={
        <>
          {documentName(invoice)} · {invoice.client.name} ·{' '}
          <span className="text-foreground tabular-nums">
            {formatMoney(invoice.refund_due, invoice.currency)}
          </span>{' '}
          owed back
        </>
      }
      action="Record refund"
      pending={add.isPending}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField id="refund-amount" label="Amount" required error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-muted-foreground">
              {invoice.currency}
            </span>
            <input
              {...describedBy('refund-amount', errors.amount)}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className={cn(fieldClass, 'pl-12 text-right tabular-nums')}
            />
          </div>
        </FormField>
        <FormField id="refund-date" label="Refunded on" required error={errors.refunded_on}>
          <input
            {...describedBy('refund-date', errors.refunded_on)}
            type="date"
            max={today()}
            value={refundedOn}
            onChange={(event) => setRefundedOn(event.target.value)}
            className={cn(fieldClass, 'tabular-nums')}
          />
        </FormField>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Method</span>
        <Segmented
          label="Refund method"
          value={method}
          options={PAYMENT_METHODS}
          onChange={setMethod}
        />
      </div>
      <FormField
        id="refund-note"
        label="Note"
        error={errors.note}
        tip="Only your team sees this, e.g. the bank’s booking text."
      >
        <input
          {...describedBy('refund-note', errors.note)}
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Paid back to the client’s account"
          className={fieldClass}
        />
      </FormField>
    </FormDialog>
  )
}

export const emails = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

/** What is wrong with the To and Cc fields of a send dialog, by field. */
export function recipientErrors(to: string, cc: string): Record<string, string> {
  const list = emails(to)
  const bad = [...list, ...emails(cc)].find(
    (address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
  )
  const found: Record<string, string> = {}
  if (list.length === 0) found.to = 'Add at least one email address.'
  else if (list.length > 10) found.to = 'At most 10 recipients.'
  else if (bad) found.to = `“${bad}” isn’t an email address.`
  if (emails(cc).length > 10) found.cc = 'At most 10 addresses in Cc.'
  return found
}

/** Sends the issued document by email with its PDF attached. */
export function SendDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem
  onClose: () => void
}) {
  const client = useClient(invoice.client.id).data
  const seller = useInvoiceSettings().data?.seller.name
  const fallback = client?.billing_email ?? client?.email ?? ''
  const [to, setTo] = useState<string | null>(null)
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const send = useSendInvoice()
  const defaultSubject = `${documentName(invoice)}${seller ? ` from ${seller}` : ''}`
  const recipients = to ?? fallback

  const submit = () => {
    const list = emails(recipients)
    const found = recipientErrors(recipients, cc)
    setErrors(found)
    if (Object.keys(found).length) return
    send.mutate(
      {
        id: invoice.id,
        input: {
          to: list,
          ...(emails(cc).length ? { cc: emails(cc) } : {}),
          // Left alone, the server writes the subject in the invoice's language.
          ...(subject?.trim() ? { subject: subject.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(`${documentName(invoice)} sent to ${list.join(', ')}.`)
          onClose()
        },
        onError: (error) => {
          const fromServer = fieldErrors(error)
          if (Object.keys(fromServer).length) setErrors(fromServer)
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <FormDialog
      title={invoice.sent_at ? 'Send again' : 'Send by email'}
      description={`${documentName(invoice)} for ${invoice.client.name} goes out with its PDF attached.`}
      action="Send"
      pending={send.isPending}
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField
        id="send-to"
        label="To"
        required
        error={errors.to}
        tip="Separate several addresses with commas. Defaults to the client’s billing email."
      >
        <input
          {...describedBy('send-to', errors.to)}
          type="email"
          multiple
          value={recipients}
          onChange={(event) => setTo(event.target.value)}
          placeholder="accounts@client.ch"
          className={fieldClass}
        />
      </FormField>
      <FormField id="send-cc" label="Cc" error={errors.cc}>
        <input
          {...describedBy('send-cc', errors.cc)}
          type="email"
          multiple
          value={cc}
          onChange={(event) => setCc(event.target.value)}
          placeholder="Optional"
          className={fieldClass}
        />
      </FormField>
      <FormField id="send-subject" label="Subject" error={errors.subject}>
        <input
          {...describedBy('send-subject', errors.subject)}
          value={subject ?? ''}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={`${defaultSubject} (in the invoice’s language)`}
          className={fieldClass}
        />
      </FormField>
      <FormField id="send-message" label="Message" error={errors.message}>
        <textarea
          {...describedBy('send-message', errors.message)}
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Hello,\n\nplease find attached ${documentName(invoice).toLowerCase()}.\n\nKind regards`}
          className={cn(fieldClass, 'h-auto resize-y py-2 leading-relaxed')}
        />
      </FormField>
    </FormDialog>
  )
}

/** Codes about the invoice settings: fixed there, the field in focus. */
const SETTINGS_CODES = new Set(['settings_incomplete', 'seller_vat_missing', 'no_iban'])
/** Codes about the client: fixed in its drawer. */
const CLIENT_CODES = new Set(['client_draft', 'buyer_vat_missing'])

/** Where a cannot_issue reason is fixed, by its code; null when the editor fixes it itself. */
export function reasonFix(
  reason: IssueReason,
  clientId: string,
): { label: string; href: string } | null {
  if (SETTINGS_CODES.has(reason.code) || reason.field?.startsWith('settings.'))
    return settingsFix(reason.field?.replace(/^settings\./, '') ?? '')
  if (CLIENT_CODES.has(reason.code))
    return { label: 'Complete the client', href: `/clients?id=${encodeURIComponent(clientId)}` }
  return null
}

/** One row per missing settings field reads as a list: they become a single row. */
export function groupReasons(reasons: IssueReason[]): IssueReason[] {
  const missing = reasons.filter((reason) => reason.code === 'settings_incomplete')
  if (missing.length < 2) return reasons
  const labels = missing.map(
    (reason) => MISSING_LABELS[reason.field?.replace(/^settings\./, '') ?? ''] ?? reason.field,
  )
  const merged: IssueReason = {
    code: 'settings_incomplete',
    field: missing[0]?.field,
    message: `Your company details are missing: ${labels.join(', ')}.`,
  }
  return [merged, ...reasons.filter((reason) => reason.code !== 'settings_incomplete')]
}

/** The reasons as rows: reasons fixed in the same place share one row and one link. */
export function issueFixes(
  reasons: IssueReason[],
  clientId: string,
  onFixInline?: (reason: IssueReason) => void,
): Fix[] {
  const fixes: Fix[] = []
  for (const reason of groupReasons(reasons)) {
    const fix = reasonFix(reason, clientId)
    const same = fix && fixes.find((row) => row.key === fix.label)
    if (same) {
      same.messages.push(reason.message)
      continue
    }
    fixes.push({
      key: fix?.label ?? `${reason.code}:${reason.field ?? ''}`,
      messages: [reason.message],
      action: fix ? (
        <FixLink href={fix.href}>{fix.label}</FixLink>
      ) : (
        onFixInline &&
        reason.field && (
          <button type="button" onClick={() => onFixInline(reason)} className={fixActionClass}>
            Show me <ArrowRight aria-hidden className="size-3.5" />
          </button>
        )
      ),
    })
  }
  return fixes
}

/** The reasons issuing was refused, each with a way to fix it when there is one. */
export function IssueBlockers({
  reasons,
  clientId,
  onFixInline,
  className,
}: {
  reasons: IssueReason[]
  clientId: string
  /** Reasons the current page fixes itself (lines, dates) get this instead of a link. */
  onFixInline?: (reason: IssueReason) => void
  className?: string
}) {
  const fixes = issueFixes(reasons, clientId, onFixInline)
  return <FixList title={fixCount(fixes.length, 'issuing')} fixes={fixes} className={className} />
}

/** The blockers in a dialog, for issuing from the list or the drawer. */
export function IssueBlockersDialog({
  reasons,
  clientId,
  editHref,
  onClose,
}: {
  reasons: IssueReason[]
  clientId: string
  editHref: string
  onClose: () => void
}) {
  return (
    <FixDialog
      title="Not ready to issue yet"
      description="Nothing was numbered or stored. Fix these, then issue again."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button asChild>
            <Link href={editHref}>Open in editor</Link>
          </Button>
        </>
      }
    >
      <IssueBlockers reasons={reasons} clientId={clientId} />
    </FixDialog>
  )
}
