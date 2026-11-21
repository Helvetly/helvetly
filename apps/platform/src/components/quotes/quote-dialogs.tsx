'use client'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { formatDate, formatMoney } from '@helvetly/ui/lib/format'
import { useQueryClient } from '@tanstack/react-query'
import { MailX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { NoClientEmail } from '@/components/clients/client-fix'
import { inputClass as fieldClass } from '@/components/clients/fields'
import { EmailMessageField } from '@/components/email-message-field'
import {
  emails,
  fieldErrors,
  FormDialog,
  MarkSentButton,
  recipientErrors,
} from '@/components/invoices/invoice-dialogs'
import { TextareaBox } from '@/components/textarea-box'
import { ApiError } from '@/lib/api'
import { isApprovalRequired, toastApprovalRequired } from '@/lib/approvals'
import { useClient } from '@/lib/clients'
import { useQuoteEmailDraft } from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import {
  quoteErrorMessage,
  quoteName,
  quotesApi,
  useQuoteAction,
  type Quote,
  type QuoteSendInput,
} from '@/lib/quotes'

/** A refused quote write: our sentence for the quote codes, else the shared handling (plan limit, 403). */
export function failQuote(error: unknown) {
  if (
    error instanceof ApiError &&
    (error.code === 'quote_invoiced' || error.code === 'mail_unavailable')
  )
    toast.error(quoteErrorMessage(error))
  else toastError(error)
}

/** Emails the quote's PDF, or only marks it sent (numbered and filed) to send it yourself. */
export function QuoteSendDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const client = useClient(quote.client.id).data
  const draft = useQuoteEmailDraft(quote.id)
  const fallback = client?.email ?? client?.billing_email ?? ''
  // null = untouched: the draft shows through, and what the user typed is never replaced by it.
  const [to, setTo] = useState<string | null>(null)
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [mailDown, setMailDown] = useState(false)
  const queryClient = useQueryClient()
  const send = useQuoteAction((input: QuoteSendInput) => quotesApi.send(quote.id, input))
  const recipients = to ?? (draft.data?.to.join(', ') || fallback)
  const shownSubject = subject ?? draft.data?.subject ?? ''
  const shownMessage = message ?? draft.data?.message ?? ''
  const name = quoteName(quote)

  const run = (input: QuoteSendInput, done: (sent: Quote) => string) =>
    send.mutate(input, {
      onSuccess: (sent) => {
        toast.success(done(sent))
        onClose()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'mail_unavailable') return setMailDown(true)
        if (isApprovalRequired(error)) {
          toastApprovalRequired(queryClient, quote.id, 'quotes')
          return onClose()
        }
        const fromServer = fieldErrors(error)
        if (Object.keys(fromServer).length) setErrors(fromServer)
        else failQuote(error)
      },
    })

  const submit = () => {
    const found: Record<string, string> = {
      ...recipientErrors(recipients, cc),
      ...(shownSubject.trim() ? {} : { subject: translate('emailSubjectRequired') }),
      ...(shownMessage.trim() ? {} : { message: translate('emailMessageRequired') }),
    }
    setErrors(found)
    if (Object.keys(found).length) return
    const list = emails(recipients)
    run(
      {
        to: list,
        ...(emails(cc).length ? { cc: emails(cc) } : {}),
        // Left empty (draft failed), the server writes both in the quote's language.
        ...(shownSubject.trim() ? { subject: shownSubject.trim() } : {}),
        ...(shownMessage.trim() ? { message: shownMessage.trim() } : {}),
      },
      (sent) => translate('sentTo', { value1: quoteName(sent), value2: list.join(', ') }),
    )
  }

  const markSent = () =>
    run({ email: false }, (sent) =>
      translate('markedAsSentSendItsPDFYourself', { value1: quoteName(sent) }),
    )

  return (
    <FormDialog
      wide
      title={quote.sent_at ? translate('sendAgain') : translate('sendQuote')}
      description={translate('forGoesOutWithItsPDFAttachedSendingGives', {
        name: name,
        value2: quote.client.name,
      })}
      action="Send"
      pending={send.isPending}
      onSubmit={submit}
      onClose={onClose}
      aside={<MarkSentButton disabled={send.isPending} onClick={markSent} />}
    >
      {mailDown && (
        <Callout tone="warning" icon={MailX}>
          {translate('emailIsnTSetUpOnThisServerMark')}
        </Callout>
      )}
      <NoClientEmail client={client} />
      <FormField
        id="quote-send-to"
        label={translate('to3')}
        required
        error={errors.to}
        tip={translate('separateSeveralAddressesWithCommasDefaultsToTheClient2')}
      >
        <input
          {...describedBy('quote-send-to', errors.to)}
          type="email"
          multiple
          value={recipients}
          // Read-only, not disabled, while the draft loads: the dialog's first focus lands here.
          readOnly={draft.isPending}
          onChange={(event) => setTo(event.target.value)}
          placeholder={translate('helloClientCh')}
          className={fieldClass}
        />
      </FormField>
      <FormField id="quote-send-cc" label={translate('cc')} error={errors.cc}>
        <input
          {...describedBy('quote-send-cc', errors.cc)}
          type="email"
          multiple
          value={cc}
          onChange={(event) => setCc(event.target.value)}
          placeholder={translate('optional')}
          className={fieldClass}
        />
      </FormField>
      <FormField
        id="quote-send-subject"
        label={translate('subject')}
        required
        error={errors.subject}
      >
        <input
          {...describedBy('quote-send-subject', errors.subject)}
          value={shownSubject}
          maxLength={200}
          disabled={draft.isPending}
          onChange={(event) => setSubject(event.target.value)}
          className={fieldClass}
        />
      </FormField>
      <EmailMessageField
        id="quote-send-message"
        required
        error={errors.message}
        value={shownMessage}
        disabled={draft.isPending}
        onChange={setMessage}
        context={{
          document: name,
          client: quote.client.name,
          amount: formatMoney(quote.total, quote.currency),
          valid_until: formatDate(quote.valid_until),
          subject: shownSubject,
        }}
      />
    </FormDialog>
  )
}

/** Records the client's answer, with an optional note (staff; the client answers in the portal). */
export function QuoteDecisionDialog({
  quote,
  accept,
  onClose,
}: {
  quote: Quote
  accept: boolean
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const decide = useQuoteAction((text: string) =>
    accept ? quotesApi.accept(quote.id, text) : quotesApi.decline(quote.id, text),
  )
  const name = quoteName(quote)

  const submit = () => {
    if (note.trim().length > 1000) return setError(translate('atMost1000Characters'))
    decide.mutate(note.trim(), {
      onSuccess: () => {
        toast.success(`${name} ${accept ? translate('accepted2') : translate('declined2')}.`)
        onClose()
      },
      onError: (failure) => {
        const fromServer = fieldErrors(failure).note
        if (fromServer) setError(fromServer)
        else failQuote(failure)
      },
    })
  }

  return (
    <FormDialog
      title={accept ? translate('accept2', { name: name }) : translate('decline2', { name: name })}
      description={
        accept
          ? translate('recordThatAcceptedYouCanThenTurnItInto', { name: quote.client.name })
          : translate('recordThatDeclinedYouCanReviseItAndSend', { name: quote.client.name })
      }
      action={accept ? 'Accept quote' : 'Decline quote'}
      pending={decide.isPending}
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField
        id="quote-decision-note"
        label={translate('note')}
        error={error}
        tip={translate('optionalEGHowTheClientAnsweredTheClient')}
      >
        <TextareaBox
          {...describedBy('quote-decision-note', error)}
          rows={3}
          value={note}
          maxLength={1000}
          max={1000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            accept ? translate('confirmedByPhoneOnMonday') : translate('wentWithAnotherOffer')
          }
          className="leading-relaxed"
        />
      </FormField>
    </FormDialog>
  )
}
