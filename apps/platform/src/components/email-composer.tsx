'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Paperclip } from 'lucide-react'

import { inputClass as fieldClass, NativeSelect } from '@/components/clients/fields'
import { EmailMessageField } from '@/components/email-message-field'
import { RecipientFields } from '@/components/recipient-fields'
import { EMAIL_LANGUAGES, type EmailLanguage, type EmailPreview } from '@/lib/email-texts'
import { translate } from '@/lib/i18n'

export type Recipients = { to: string; cc: string; bcc: string }

/**
 * The one way an email with a document is written, wherever a document is sent: To (Cc and Bcc behind their
 * toggles), the subject (or a signature request's title), the message with Write with AI and its count, and what
 * goes with it. Field ids are `<id>-to`, `<id>-cc`, `<id>-bcc`, `<id>-subject` and `<id>-message`; errors use the
 * same keys (`to`, `cc`, `bcc`, `subject`, `message`).
 */
export function EmailComposer({
  id,
  recipients,
  onRecipients,
  toTip = translate('separateSeveralAddressesWithCommasDefaultsToTheClient'),
  toPlaceholder = translate('accountsClientCh'),
  toReadOnly,
  subjectLabel = translate('subject'),
  subject,
  onSubject,
  subjectRequired = true,
  message,
  onMessage,
  messageRequired,
  messagePlaceholder,
  errors,
  disabled,
  replyTo,
  context,
  language,
  attachments,
  people,
}: {
  id: string
  /** None for an email whose recipients are chosen elsewhere (a signature request's signers). */
  recipients?: Recipients
  onRecipients?: (recipients: Recipients) => void
  toTip?: string
  toPlaceholder?: string
  /** Read-only, not disabled, while a draft loads: the dialog's first focus lands in To. */
  toReadOnly?: boolean
  subjectLabel?: string
  /** None hides the field (the title is asked for elsewhere). */
  subject?: string
  onSubject?: (subject: string) => void
  subjectRequired?: boolean
  message: string
  onMessage: (message: string) => void
  messageRequired?: boolean
  messagePlaceholder?: string
  errors: Record<string, string>
  /** While the template's draft loads. */
  disabled?: boolean
  replyTo?: string
  /** What the email is about, for Write with AI. */
  context: Record<string, string | undefined>
  /** The recipient's language: Write with AI offers to translate into it. */
  language?: EmailLanguage
  /** The files the email carries, by name. */
  attachments?: string[]
  /** The client's contacts and participants, offered as recipients. */
  people?: { name: string; email: string }[]
}) {
  return (
    <>
      {recipients && onRecipients && (
        <RecipientFields
          id={id}
          to={recipients.to}
          onToChange={(to) => onRecipients({ ...recipients, to })}
          toTip={toTip}
          toPlaceholder={toPlaceholder}
          toReadOnly={toReadOnly}
          cc={recipients.cc}
          onCcChange={(cc) => onRecipients({ ...recipients, cc })}
          bcc={recipients.bcc}
          onBccChange={(bcc) => onRecipients({ ...recipients, bcc })}
          errors={errors}
          people={people}
        />
      )}
      {subject !== undefined && onSubject && (
        <FormField
          id={`${id}-subject`}
          label={subjectLabel}
          required={subjectRequired}
          error={errors.subject}
        >
          <input
            {...describedBy(`${id}-subject`, errors.subject)}
            value={subject}
            maxLength={200}
            disabled={disabled}
            onChange={(event) => onSubject(event.target.value)}
            className={fieldClass}
          />
        </FormField>
      )}
      <EmailMessageField
        id={`${id}-message`}
        required={messageRequired}
        error={errors.message}
        value={message}
        disabled={disabled}
        onChange={onMessage}
        placeholder={messagePlaceholder}
        replyTo={replyTo}
        language={language}
        context={{ ...context, subject }}
      />
      {attachments && attachments.length > 0 && (
        <ul aria-label={translate('attachments')} className="grid gap-1">
          {attachments.map((name) => (
            <li
              key={name}
              className="flex min-w-0 items-center gap-2 text-body-sm text-muted-foreground"
            >
              <Paperclip className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * The email as the recipient gets it: the subject, then the real branded email in a sandboxed frame (no scripts,
 * no navigation), updated as one writes.
 */
export function EmailPreviewPane({
  preview,
  pending,
}: {
  preview: EmailPreview | undefined
  pending: boolean
}) {
  return (
    <section
      aria-label={translate('emailPreview')}
      className="absolute inset-0 grid min-h-0 grid-rows-[auto_1fr] gap-2 p-5 md:p-7"
    >
      <div className="grid gap-0.5">
        <span className="text-xs text-muted-foreground">{translate('emailPreview')}</span>
        <span data-slot="preview-subject" className="truncate text-body font-medium">
          {preview?.subject ?? ''}
        </span>
      </div>
      <div className="relative min-h-80 overflow-hidden rounded-xl border bg-white">
        {preview ? (
          <iframe
            title={translate('emailPreview')}
            sandbox=""
            srcDoc={preview.html}
            className="size-full min-h-80"
          />
        ) : (
          pending && <Loader className="min-h-80" />
        )}
      </div>
    </section>
  )
}

const LANGUAGE_NAMES: Record<EmailLanguage, () => string> = {
  de: () => translate('deutsch'),
  fr: () => translate('franAis'),
  it: () => translate('italiano'),
  en: () => translate('english'),
}

/** The language the email is written in: its template's, and the one Write with AI writes in. */
export function EmailLanguageField({
  id,
  value,
  onChange,
}: {
  id: string
  value: EmailLanguage
  onChange: (language: EmailLanguage) => void
}) {
  return (
    <FormField id={id} label={translate('emailLanguage')} tip={translate('emailLanguageTip')}>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) =>
          onChange(EMAIL_LANGUAGES.find((code) => code === event.target.value) ?? value)
        }
      >
        {EMAIL_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_NAMES[code]()}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  )
}
