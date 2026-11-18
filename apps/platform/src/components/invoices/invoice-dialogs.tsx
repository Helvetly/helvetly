'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Segmented } from '@helvetly/ui/components/segmented'
import { CountedTextarea } from '@helvetly/ui/components/textarea'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, MailX } from 'lucide-react'
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
import { useInvoiceEmailDraft } from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
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
  useMarkPaid,
  useSendInvoice,
  type InvoiceListItem,
  type IssueReason,
  type PaymentMethod,
  type SendInput,
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
  wide = false,
}: {
  title: string
  description: ReactNode
  action: string
  pending: boolean
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
  aside?: ReactNode
  /** Room for writing, e.g. an email's message. */
  wide?: boolean
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          wide ? 'w-[min(640px,calc(100vw-2rem))]' : 'w-[min(440px,calc(100vw-2rem))]',
          'max-w-none! gap-0 rounded-2xl p-0 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.25),0_4px_12px_rgb(0_0_0/0.06)]',
        )}
      >
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
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? translate('working') : action}
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
    if (!value || toCents(value) <= 0n) found.amount = translate('enterAnAmountAbove0')
    else if (toCents(value) > toCents(invoice.amount_due))
      found.amount = translate('atMostIsStillDue', {
        value1: formatMoney(invoice.amount_due, invoice.currency),
      })
    if (!paidOn) found.paid_on = translate('chooseTheDayItArrived')
    else if (paidOn > today()) found.paid_on = translate('thePaymentDateCanTBeInTheFuture')
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
              ? translate('isPaidInFull', { value1: documentName(updated) })
              : translate('paymentOfRecorded', { value1: formatMoney(value, invoice.currency) }),
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
      title={translate('recordAPayment')}
      description={
        <>
          {documentName(invoice)} · {invoice.client.name} ·{' '}
          <span className="text-foreground tabular-nums">
            {formatMoney(invoice.amount_due, invoice.currency)}
          </span>{' '}
          {translate('due4')}
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
                toast.success(translate('markedAsPaid', { value1: documentName(updated) }))
                onClose()
              },
              onError: toastError,
            })
          }
        >
          {translate('markFullyPaidToday')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField id="payment-amount" label={translate('amount')} required error={errors.amount}>
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
        <FormField id="payment-date" label={translate('paidOn')} required error={errors.paid_on}>
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
        <span className="text-[13px] font-medium">{translate('method')}</span>
        <Segmented
          label={translate('paymentMethod')}
          value={method}
          options={PAYMENT_METHODS}
          onChange={setMethod}
        />
      </div>
      <FormField
        id="payment-note"
        label={translate('note')}
        error={errors.note}
        tip={translate('onlyYourTeamSeesThisEGTheBank')}
      >
        <input
          {...describedBy('payment-note', errors.note)}
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder={translate('eGPartialPaymentRestInDecember')}
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
    if (!value || toCents(value) <= 0n) found.amount = translate('enterAnAmountAbove0')
    else if (toCents(value) > toCents(invoice.refund_due))
      found.amount = translate('atMostIsOwedBack', {
        value1: formatMoney(invoice.refund_due, invoice.currency),
      })
    if (!refundedOn) found.refunded_on = translate('chooseTheDayItWasPaidBack')
    else if (refundedOn > today()) found.refunded_on = translate('theRefundDateCanTBeInTheFuture')
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
          toast.success(
            translate('refundOfRecorded', { value1: formatMoney(value, invoice.currency) }),
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
      title={translate('recordARefund')}
      description={
        <>
          {documentName(invoice)} · {invoice.client.name} ·{' '}
          <span className="text-foreground tabular-nums">
            {formatMoney(invoice.refund_due, invoice.currency)}
          </span>{' '}
          {translate('owedBack2')}
        </>
      }
      action="Record refund"
      pending={add.isPending}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField id="refund-amount" label={translate('amount')} required error={errors.amount}>
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
        <FormField
          id="refund-date"
          label={translate('refundedOn')}
          required
          error={errors.refunded_on}
        >
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
        <span className="text-[13px] font-medium">{translate('method')}</span>
        <Segmented
          label={translate('refundMethod')}
          value={method}
          options={PAYMENT_METHODS}
          onChange={setMethod}
        />
      </div>
      <FormField
        id="refund-note"
        label={translate('note')}
        error={errors.note}
        tip={translate('onlyYourTeamSeesThisEGTheBank')}
      >
        <input
          {...describedBy('refund-note', errors.note)}
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder={translate('eGPaidBackToTheClientSAccount')}
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
  if (list.length === 0) found.to = translate('addAtLeastOneEmailAddress')
  else if (list.length > 10) found.to = translate('atMost10Recipients')
  else if (bad) found.to = translate('isnTAnEmailAddress', { bad: bad })
  if (emails(cc).length > 10) found.cc = translate('atMost10AddressesInCc')
  return found
}

/** Sends the issued document by email with its PDF attached, or only marks it sent to send it yourself. */
export function SendDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem
  onClose: () => void
}) {
  const client = useClient(invoice.client.id).data
  const draft = useInvoiceEmailDraft(invoice.id)
  const fallback = client?.billing_email ?? client?.email ?? ''
  // null = untouched: the draft shows through, and what the user typed is never replaced by it.
  const [to, setTo] = useState<string | null>(null)
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [mailDown, setMailDown] = useState(false)
  const send = useSendInvoice()
  const recipients = to ?? (draft.data?.to.join(', ') || fallback)
  const shownSubject = subject ?? draft.data?.subject ?? ''
  const shownMessage = message ?? draft.data?.message ?? ''

  const run = (input: SendInput, done: string) =>
    send.mutate(
      { id: invoice.id, input },
      {
        onSuccess: () => {
          toast.success(done)
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'mail_unavailable')
            return setMailDown(true)
          const fromServer = fieldErrors(error)
          if (Object.keys(fromServer).length) setErrors(fromServer)
          else toast.error(errorMessage(error))
        },
      },
    )

  const submit = () => {
    const list = emails(recipients)
    const found: Record<string, string> = {
      ...recipientErrors(recipients, cc),
      ...(shownSubject.trim() ? {} : { subject: translate('emailSubjectRequired') }),
      ...(shownMessage.trim() ? {} : { message: translate('emailMessageRequired') }),
    }
    setErrors(found)
    if (Object.keys(found).length) return
    run(
      {
        to: list,
        ...(emails(cc).length ? { cc: emails(cc) } : {}),
        // Left empty (draft failed), the server writes both in the invoice's language.
        ...(shownSubject.trim() ? { subject: shownSubject.trim() } : {}),
        ...(shownMessage.trim() ? { message: shownMessage.trim() } : {}),
      },
      translate('sentTo', { value1: documentName(invoice), value2: list.join(', ') }),
    )
  }

  const markSent = () =>
    run(
      { email: false },
      translate('markedAsSentSendItsPDFYourself', { value1: documentName(invoice) }),
    )

  return (
    <FormDialog
      title={invoice.sent_at ? translate('sendAgain') : translate('sendByEmail')}
      description={translate('forGoesOutWithItsPDFAttached', {
        value1: documentName(invoice),
        name: invoice.client.name,
      })}
      action="Send"
      wide
      pending={send.isPending}
      onSubmit={submit}
      onClose={onClose}
      aside={
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground"
          disabled={send.isPending}
          onClick={markSent}
        >
          {translate('markAsSentWithoutEmail')}
        </Button>
      }
    >
      {mailDown && (
        <Callout tone="warning" icon={MailX}>
          {translate('emailIsnTSetUpOnThisServerMarkTheInvoice')}
        </Callout>
      )}
      <FormField
        id="send-to"
        label={translate('to3')}
        required
        error={errors.to}
        tip={translate('separateSeveralAddressesWithCommasDefaultsToTheClient')}
      >
        <input
          {...describedBy('send-to', errors.to)}
          type="email"
          multiple
          value={recipients}
          disabled={draft.isPending}
          onChange={(event) => setTo(event.target.value)}
          placeholder={translate('accountsClientCh')}
          className={fieldClass}
        />
      </FormField>
      <FormField id="send-cc" label={translate('cc')} error={errors.cc}>
        <input
          {...describedBy('send-cc', errors.cc)}
          type="email"
          multiple
          value={cc}
          onChange={(event) => setCc(event.target.value)}
          placeholder={translate('optional')}
          className={fieldClass}
        />
      </FormField>
      <FormField id="send-subject" label={translate('subject')} required error={errors.subject}>
        <input
          {...describedBy('send-subject', errors.subject)}
          value={shownSubject}
          maxLength={200}
          disabled={draft.isPending}
          onChange={(event) => setSubject(event.target.value)}
          className={fieldClass}
        />
      </FormField>
      <FormField id="send-message" label={translate('message')} required error={errors.message}>
        <CountedTextarea
          {...describedBy('send-message', errors.message)}
          rows={10}
          maxLength={5000}
          value={shownMessage}
          disabled={draft.isPending}
          onChange={(event) => setMessage(event.target.value)}
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
    return {
      label: translate('completeTheClient'),
      href: `/clients?id=${encodeURIComponent(clientId)}`,
    }
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
    message: translate('yourCompanyDetailsAreMissing', { value1: labels.join(', ') }),
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
            {translate('showMe')}
            <ArrowRight aria-hidden className="size-3.5" />
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
      title={translate('notReadyToIssueYet')}
      description={translate('nothingWasNumberedOrStoredFixTheseThenIssue')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {translate('close')}
          </Button>
          <Button asChild>
            <Link href={editHref}>{translate('openInEditor')}</Link>
          </Button>
        </>
      }
    >
      <IssueBlockers reasons={reasons} clientId={clientId} />
    </FixDialog>
  )
}
