'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Reply } from 'lucide-react'

import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { translate } from '@/lib/i18n'
import { useReplyTo, useSetReplyTo } from '@/lib/workspaces'

import { FieldGrid, SettingsSection } from './layout'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Where clients' answers to the workspace's email go (Reply-To); empty uses the company email. */
export function ReplyToSection({ canEdit }: { canEdit: boolean }) {
  const replyTo = useReplyTo()
  // Keyed by the saved address: a saved change starts the form again from it.
  return replyTo.isSuccess ? (
    <ReplyToForm key={replyTo.data ?? ''} saved={replyTo.data ?? ''} canEdit={canEdit} />
  ) : null
}

function ReplyToForm({ saved, canEdit }: { saved: string; canEdit: boolean }) {
  const setReplyTo = useSetReplyTo()
  const form = useSectionForm({
    initial: { reply_to_email: saved },
    sections: [{ id: 'reply-to', fields: ['reply_to_email'] }],
    validate: (values) => {
      const address = values.reply_to_email.trim()
      return address && !EMAIL.test(address)
        ? { reply_to_email: translate('checkTheEmailAddress') }
        : {}
    },
    save: (values) => setReplyTo.mutateAsync(values.reply_to_email.trim()),
    fieldErrors: (error) =>
      apiFieldErrors(error)?.reply_to_email
        ? { reply_to_email: translate('checkTheEmailAddress') }
        : null,
    savedMessage: () => translate('replyToSaved'),
  })
  const section = form.section('reply-to')
  return (
    <SettingsSection
      id="workspace-reply-to"
      icon={Reply}
      title={translate('clientEmailReplies')}
      section={canEdit ? section : undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          section.save()
        }}
        noValidate
      >
        <FieldGrid>
          <FormField
            id="workspace-reply-to-email"
            label={translate('replyToEmail')}
            width="md"
            error={form.errors.reply_to_email}
            tip={translate('replyToEmailHelp')}
            status={canEdit ? undefined : translate('replyToAdminOnly')}
          >
            <Input
              {...describedBy('workspace-reply-to-email', form.errors.reply_to_email)}
              type="email"
              disabled={!canEdit}
              value={form.values.reply_to_email}
              placeholder={translate('replyToEmailPlaceholder')}
              onChange={(event) => form.set('reply_to_email', event.target.value)}
            />
          </FormField>
        </FieldGrid>
      </form>
    </SettingsSection>
  )
}
