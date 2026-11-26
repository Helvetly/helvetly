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
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MailCheck, MailX } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ClientFixButton, NoClientEmail } from '@/components/clients/client-fix'
import { inputClass as fieldClass } from '@/components/clients/fields'
import { EmailComposer } from '@/components/email-composer'
import {
  fixActionClass,
  fixCount,
  FixDialog,
  FixLink,
  FixList,
  type Fix,
} from '@/components/fix-list'
import { RecordLink } from '@/components/record-link'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient } from '@/lib/clients'
import { useInvoiceEmailDraft } from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import {
  documentName,
  formatMoney,
  invoiceKeys,
  MISSING_LABELS,
  parseDecimalInput,
  settingsFix,
  PAYMENT_METHODS,
  today,
  toCents,
  useAddPayment,
  useAddRefund,
  useInvoice,
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

/** A send dialog's second way out: the document already went by post, by the user's own email or by hand. */
export function MarkSentButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} onClick={onClick}>
          <MailCheck />
          {translate('markAsSent')}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{translate('markAsSentTip')}</TooltipContent>
    </Tooltip>
  )
}

/** Marks an issued invoice sent without an email; the toast's undo takes the mark back. */
export function useMarkSent() {
  const send = useSendInvoice()
  const mark = (invoice: InvoiceListItem, onDone?: () => void) =>
    send.mutate(
      { id: invoice.id, input: { email: false } },
      {
        onSuccess: () => {
          onDone?.()
          toast.success(
            translate('markedAsSentSendItsPDFYourself', { value1: documentName(invoice) }),
            {
              action: {
                label: translate('undo'),
                // mutateAsync, not mutate: the dialog that marked it may be gone by now.
                onClick: () =>
                  void send
                    .mutateAsync({ id: invoice.id, input: { email: false, sent: false } })
                    .catch((error: unknown) => toast.error(errorMessage(error))),
              },
            },
          )
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    )
  return { mark, pending: send.isPending }
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

export function PaymentDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem
  onClose: () => void
}) {
  const { data: detail } = useInvoice(invoice.id)
  const amountDue = detail?.amount_due ?? invoice.amount_due
  const nextInstalment = detail?.instalments?.items.find((item) => toCents(item.open) > 0n)
  const [amount, setAmount] = useState(amountDue)
  const [paidOn, setPaidOn] = useState(today())
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const add = useAddPayment()

  const submit = () => {
    const value = parseDecimalInput(amount, 2, true)
    const found: Record<string, string> = {}
    if (!value || toCents(value) <= 0n) found.amount = translate('enterAnAmountAbove0')
    else if (toCents(value) > toCents(amountDue))
      found.amount = translate('atMostIsStillDue', {
        value1: formatMoney(amountDue, invoice.currency),
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
            {formatMoney(amountDue, invoice.currency)}
          </span>{' '}
          {translate('due4')}
        </>
      }
      action={translate('recordPayment2')}
      pending={add.isPending}
      onSubmit={submit}
      onClose={onClose}
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
      {nextInstalment && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          disabled={add.isPending}
          onClick={() => {
            setAmount(nextInstalment.open)
            setErrors((current) => ({ ...current, amount: '' }))
          }}
        >
          {translate('useInstalmentAmount', {
            number: nextInstalment.seq,
            amount: formatMoney(nextInstalment.open, invoice.currency),
          })}
        </Button>
      )}
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

/** What is wrong with the To, Cc and Bcc fields of a send dialog, by field. */
export function recipientErrors(to: string, cc: string, bcc = ''): Record<string, string> {
  const found: Record<string, string> = {}
  const fields = [
    { key: 'to', list: emails(to), tooMany: translate('atMost10Recipients') },
    { key: 'cc', list: emails(cc), tooMany: translate('atMost10AddressesInCc') },
    { key: 'bcc', list: emails(bcc), tooMany: translate('atMost10AddressesInBcc') },
  ]
  for (const { key, list, tooMany } of fields) {
    const bad = list.find((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    if (list.length > 10) found[key] = tooMany
    else if (bad) found[key] = translate('isnTAnEmailAddress', { bad: bad })
  }
  if (emails(to).length === 0) found.to = translate('addAtLeastOneEmailAddress')
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
  const queryClient = useQueryClient()
  const fallback = client?.billing_email ?? client?.email ?? ''
  // null = untouched: the draft shows through, and what the user typed is never replaced by it.
  const [to, setTo] = useState<string | null>(null)
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
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
          if (error instanceof ApiError && error.code === 'delivery_uncertain') {
            toast.error(translate('reminderDeliveryUnconfirmed'))
            void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(invoice.id) })
            return onClose()
          }
          if (error instanceof ApiError && error.status === 409) void draft.refetch()
          const fromServer = fieldErrors(error)
          if (Object.keys(fromServer).length) setErrors(fromServer)
          else toast.error(errorMessage(error))
        },
      },
    )

  const submit = () => {
    const list = emails(recipients)
    const found: Record<string, string> = {
      ...recipientErrors(recipients, cc, bcc),
      ...(shownSubject.trim() ? {} : { subject: translate('emailSubjectRequired') }),
      ...(shownMessage.trim() ? {} : { message: translate('emailMessageRequired') }),
    }
    setErrors(found)
    if (Object.keys(found).length) return
    run(
      {
        to: list,
        ...(emails(cc).length ? { cc: emails(cc) } : {}),
        ...(emails(bcc).length ? { bcc: emails(bcc) } : {}),
        ...(draft.data?.amount_due !== undefined
          ? { expected_amount_due: draft.data.amount_due }
          : {}),
        ...(shownSubject.trim() ? { subject: shownSubject.trim() } : {}),
        ...(shownMessage.trim() ? { message: shownMessage.trim() } : {}),
      },
      translate('sentTo', { value1: documentName(invoice), value2: list.join(', ') }),
    )
  }

  const markSent = useMarkSent()

  return (
    <FormDialog
      title={invoice.sent_at ? translate('sendAgain') : translate('sendByEmail')}
      description={translate('forGoesOutWithItsPDFAttached', {
        value1: documentName(invoice),
        name: invoice.client.name,
      })}
      action={translate('send')}
      wide
      pending={send.isPending || markSent.pending}
      onSubmit={submit}
      onClose={onClose}
      aside={
        <MarkSentButton
          disabled={send.isPending || markSent.pending}
          onClick={() => markSent.mark(invoice, onClose)}
        />
      }
    >
      {mailDown && (
        <Callout tone="warning" icon={MailX}>
          {translate('emailIsnTSetUpOnThisServerMarkTheInvoice')}
        </Callout>
      )}
      <NoClientEmail client={client} />
      <EmailComposer
        id="send"
        recipients={{ to: recipients, cc, bcc }}
        onRecipients={(next) => {
          if (next.to !== recipients) setTo(next.to)
          setCc(next.cc)
          setBcc(next.bcc)
        }}
        toReadOnly={draft.isPending}
        subject={shownSubject}
        onSubject={setSubject}
        message={shownMessage}
        onMessage={setMessage}
        messageRequired
        disabled={draft.isPending}
        errors={errors}
        replyTo={draft.data?.reply_to}
        attachments={[`${documentName(invoice)}.pdf`]}
        context={{
          document: documentName(invoice),
          client: invoice.client.name,
          amount: formatMoney(invoice.amount_due, invoice.currency),
          due_date: formatDate(invoice.due_date),
        }}
      />
    </FormDialog>
  )
}

/** Codes about the invoice settings: fixed there, the field in focus. */
const SETTINGS_CODES = new Set(['settings_incomplete', 'seller_vat_missing', 'no_iban'])
/** Codes about the client: fixed in its drawer. */
const CLIENT_CODES = new Set(['client_draft', 'buyer_vat_missing'])

/**
 * Where a cannot_issue reason is fixed, by its code: a settings page, or the client's form opened in place (`href`
 * null); null when the editor fixes it itself.
 */
export function reasonFix(reason: IssueReason): { label: string; href: string | null } | null {
  if (SETTINGS_CODES.has(reason.code) || reason.field?.startsWith('settings.'))
    return settingsFix(reason.field?.replace(/^settings\./, '') ?? '')
  if (CLIENT_CODES.has(reason.code)) return { label: translate('completeTheClient'), href: null }
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
    const fix = reasonFix(reason)
    const same = fix && fixes.find((row) => row.key === fix.label)
    if (same) {
      same.messages.push(reason.message)
      continue
    }
    fixes.push({
      key: fix?.label ?? `${reason.code}:${reason.field ?? ''}`,
      messages: [reason.message],
      action: fix?.href ? (
        <FixLink href={fix.href}>{fix.label}</FixLink>
      ) : fix ? (
        <ClientFixButton
          clientId={clientId}
          focus={reason.code === 'client_draft' ? 'address' : 'vat_number'}
          className={fixActionClass}
        >
          {fix.label}
          <ArrowRight aria-hidden className="size-3.5" />
        </ClientFixButton>
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
            <RecordLink href={editHref} onClick={onClose}>
              {translate('openInEditor')}
            </RecordLink>
          </Button>
        </>
      }
    >
      <IssueBlockers reasons={reasons} clientId={clientId} />
    </FixDialog>
  )
}
