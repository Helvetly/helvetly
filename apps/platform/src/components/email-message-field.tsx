'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'

import { AIWrite } from '@/components/ai/ai-write'
import { TextareaBox } from '@/components/textarea-box'
import { translate } from '@/lib/i18n'

/** The longest message of an email sent with a document; the API refuses more (emailtemplate.MaxMessage). */
export const EMAIL_MESSAGE_MAX = 2500

/**
 * The message of every send-by-email dialog: a fixed-height box (the text scrolls inside), Write with AI at its
 * bottom left and the character count at its bottom right.
 */
export function EmailMessageField({
  id,
  value,
  onChange,
  error,
  required,
  disabled,
  placeholder,
  context,
  replyTo,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  /** What the email is about (document, number, client, amount, due date, subject…) for Write with AI. */
  context: Record<string, string | undefined>
  /** Where the client's answer lands (the email's Reply-To), shown under the box. */
  replyTo?: string
}) {
  return (
    <FormField
      id={id}
      label={translate('message')}
      required={required}
      error={error}
      status={replyTo ? translate('repliesGoTo', { email: replyTo }) : undefined}
    >
      <TextareaBox
        {...describedBy(id, error)}
        resizable={false}
        maxLength={EMAIL_MESSAGE_MAX}
        max={EMAIL_MESSAGE_MAX}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-56 leading-relaxed"
        tools={
          <AIWrite
            field="email_message"
            text={value}
            maxLength={EMAIL_MESSAGE_MAX}
            context={context}
            onApply={onChange}
          />
        }
      />
    </FormField>
  )
}
