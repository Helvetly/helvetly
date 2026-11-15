'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { cn } from '@helvetly/ui/lib/utils'
import { MailX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { inputClass as fieldClass } from '@/components/clients/fields'
import {
  emails,
  fieldErrors,
  FormDialog,
  recipientErrors,
} from '@/components/invoices/invoice-dialogs'
import { ApiError } from '@/lib/api'
import { useClient } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useInvoiceSettings } from '@/lib/invoices'
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
  const seller = useInvoiceSettings().data?.seller.name
  const fallback = client?.email ?? client?.billing_email ?? ''
  const [to, setTo] = useState<string | null>(null)
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [mailDown, setMailDown] = useState(false)
  const send = useQuoteAction((input: QuoteSendInput) => quotesApi.send(quote.id, input))
  const recipients = to ?? fallback
  const name = quoteName(quote)

  const run = (input: QuoteSendInput, done: (sent: Quote) => string) =>
    send.mutate(input, {
      onSuccess: (sent) => {
        toast.success(done(sent))
        onClose()
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'mail_unavailable') return setMailDown(true)
        const fromServer = fieldErrors(error)
        if (Object.keys(fromServer).length) setErrors(fromServer)
        else failQuote(error)
      },
    })

  const submit = () => {
    const found = recipientErrors(recipients, cc)
    setErrors(found)
    if (Object.keys(found).length) return
    const list = emails(recipients)
    run(
      {
        to: list,
        ...(emails(cc).length ? { cc: emails(cc) } : {}),
        // Left empty, the server writes the subject and text in the quote's language.
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
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
      title={quote.sent_at ? translate('sendAgain') : translate('sendQuote')}
      description={translate('forGoesOutWithItsPDFAttachedSendingGives', {
        name: name,
        value2: quote.client.name,
      })}
      action="Send"
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
          {translate('emailIsnTSetUpOnThisServerMark')}
        </Callout>
      )}
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
      <FormField id="quote-send-subject" label={translate('subject')} error={errors.subject}>
        <input
          {...describedBy('quote-send-subject', errors.subject)}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={translate('inTheQuoteSLanguage', {
            name: name,
            value2: seller ? translate('from2', { seller: seller }) : '',
          })}
          className={fieldClass}
        />
      </FormField>
      <FormField id="quote-send-message" label={translate('message')} error={errors.message}>
        <textarea
          {...describedBy('quote-send-message', errors.message)}
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={translate('helloPleaseFindOurQuoteAttachedKindRegards')}
          className={cn(fieldClass, 'h-auto resize-y py-2 leading-relaxed')}
        />
      </FormField>
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
        <textarea
          {...describedBy('quote-decision-note', error)}
          rows={3}
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            accept ? translate('confirmedByPhoneOnMonday') : translate('wentWithAnotherOffer')
          }
          className={cn(fieldClass, 'h-auto resize-y py-2 leading-relaxed')}
        />
      </FormField>
    </FormDialog>
  )
}
