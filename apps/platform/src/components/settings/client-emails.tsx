'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Textarea } from '@helvetly/ui/components/textarea'
import { MailCheck, PanelBottom } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { translate } from '@/lib/i18n'
import { useInvoiceSettings, useSaveInvoiceSettings, type SettingsInput } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import { useClientEmails, useSetClientEmails, type ClientEmails } from '@/lib/workspaces'

import { FieldGrid, SettingsPage, SettingsSection } from './layout'
import { ReplyToSection } from './reply-to-email'
import { isManager, SettingsHeader } from './settings-tabs'

export const MAX_FOOTER = 300
export const MAX_FOOTER_LINES = 4

/** The footer as the API stores it: each line trimmed, the ends cut. */
export const cleanFooter = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join('\n')
    .trim()

export const footerTooLong = (text: string) => {
  const clean = cleanFooter(text)
  return [...clean].length > MAX_FOOTER || clean.split('\n').length > MAX_FOOTER_LINES
}

/**
 * Settings → Client emails: every automatic email to clients turned on or off in one list, where clients' replies
 * go, and the footer under every email. The wording is Helvetly's; a person changes it only in a Send dialog.
 */
export function ClientEmailsSettings() {
  const session = useSession().data
  const manager = isManager(session?.role)
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('clientEmails')}
        description={translate('clientEmailsPageDescription')}
      >
        {session ? (
          <>
            <AutomaticEmails manager={manager} />
            <ReplyToSection canEdit={manager} />
            <FooterSection canEdit={manager} />
          </>
        ) : (
          <Loader className="min-h-36" />
        )}
      </SettingsPage>
    </>
  )
}

type Row = {
  id: string
  label: string
  description: string
  checked: boolean
  save: (on: boolean) => Promise<unknown>
  disabledReason?: string
  link?: { href: string; label: string }
}

function AutomaticEmails({ manager }: { manager: boolean }) {
  const invoices = useInvoiceSettings().data
  const saveInvoices = useSaveInvoiceSettings()
  const emails = useClientEmails().data
  const setEmails = useSetClientEmails()
  const canInvoices = useCan('write:invoice-settings')
  const automations = useFeatureLock('automations')
  if (!invoices || !emails) return <Loader className="min-h-36" />

  const invoiceRow = (change: (on: boolean) => SettingsInput) => ({
    save: (on: boolean) => saveInvoices.mutateAsync(change(on)),
    disabledReason: canInvoices ? undefined : translate('clientEmailsInvoiceSettingsOnly'),
  })
  const workspaceRow = (key: keyof Omit<ClientEmails, 'email_footer'>) => ({
    checked: emails[key],
    save: (on: boolean) => setEmails.mutateAsync({ [key]: on }),
    disabledReason: manager ? undefined : translate('clientEmailsAdminOnly'),
  })
  const rows: Row[] = [
    {
      id: 'payment-confirmation',
      label: translate('emailClientsAPaymentConfirmation'),
      description: translate('emailClientsAPaymentConfirmationHelp'),
      checked: invoices.payment_confirmation,
      ...invoiceRow((on) => ({ payment_confirmation: on })),
    },
    {
      id: 'instalment-invoices',
      label: translate('emailInstalmentInvoicesWhenIssued'),
      description: translate('clientEmailsInstalmentInvoicesHelp'),
      checked: invoices.instalments.plan_auto_send,
      ...invoiceRow((on) => ({ instalments: { plan_auto_send: on } })),
    },
    {
      id: 'instalment-reminders',
      label: translate('clientEmailsInstalmentReminders'),
      description: translate('emailsTheClientBeforeAndAfterEachInstalmentIs'),
      checked: invoices.instalments.reminders_enabled,
      ...invoiceRow((on) => ({ instalments: { reminders_enabled: on } })),
      link: {
        href: '/settings/invoices#instalments',
        label: translate('clientEmailsReminderDays'),
      },
    },
    {
      id: 'dunning',
      label: translate('clientEmailsOverdueReminders'),
      description: translate('eachStepGoesOutOnceToTheClientS'),
      checked: invoices.dunning.enabled,
      ...invoiceRow((on) => ({ dunning: { enabled: on } })),
      // A plan without automations keeps a reminder already on, and offers no way to turn one on.
      ...(automations && !invoices.dunning.enabled && canInvoices
        ? { disabledReason: `${automations.hint}.` }
        : {}),
      link: { href: '/settings/invoices#dunning', label: translate('clientEmailsReminderSteps') },
    },
    {
      id: 'session-reminders',
      label: translate('clientEmailsSessionReminders'),
      description: translate('clientEmailsSessionRemindersHelp'),
      ...workspaceRow('session_reminders'),
      link: { href: '/settings/scheduling', label: translate('clientEmailsReminderTimes') },
    },
    {
      id: 'portal-invitations',
      label: translate('clientEmailsPortalInvitations'),
      description: translate('clientEmailsPortalInvitationsHelp'),
      ...workspaceRow('portal_invitations'),
    },
  ]
  const busy = saveInvoices.isPending || setEmails.isPending
  return (
    <SettingsSection
      id="client-emails-automatic"
      icon={MailCheck}
      title={translate('clientEmailsAutomatic')}
      description={translate('clientEmailsAutomaticDescription')}
    >
      {rows.map((row) => (
        <div key={row.id} className="grid gap-1.5">
          <SwitchRow
            id={`client-emails-${row.id}`}
            label={row.label}
            description={row.description}
            checked={row.checked}
            disabled={busy}
            disabledReason={row.disabledReason}
            onCheckedChange={(on) =>
              row
                .save(on)
                .then(() =>
                  toast.success(
                    translate(on ? 'clientEmailTurnedOn' : 'clientEmailTurnedOff', {
                      name: row.label,
                    }),
                  ),
                )
                .catch(toastError)
            }
          />
          {row.link && (
            <Link
              href={row.link.href}
              className="justify-self-start px-4 text-body-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {row.link.label}
            </Link>
          )}
        </div>
      ))}
    </SettingsSection>
  )
}

function FooterSection({ canEdit }: { canEdit: boolean }) {
  const emails = useClientEmails()
  // Keyed by the saved footer: a saved change starts the form again from it.
  return emails.isSuccess ? (
    <FooterForm key={emails.data.email_footer} saved={emails.data.email_footer} canEdit={canEdit} />
  ) : null
}

function FooterForm({ saved, canEdit }: { saved: string; canEdit: boolean }) {
  const setEmails = useSetClientEmails()
  const form = useSectionForm({
    initial: { email_footer: saved },
    sections: [{ id: 'footer', fields: ['email_footer'] }],
    validate: (values) =>
      footerTooLong(values.email_footer) ? { email_footer: translate('emailFooterTooLong') } : {},
    save: (values) => setEmails.mutateAsync({ email_footer: cleanFooter(values.email_footer) }),
    fieldErrors: (error) =>
      apiFieldErrors(error)?.email_footer
        ? { email_footer: translate('emailFooterTooLong') }
        : null,
    savedMessage: () => translate('emailFooterSaved'),
  })
  const section = form.section('footer')
  const preview = cleanFooter(form.values.email_footer)
  return (
    <SettingsSection
      id="client-emails-footer"
      icon={PanelBottom}
      title={translate('emailFooter')}
      description={translate('emailFooterDescription')}
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
            id="client-emails-footer-text"
            label={translate('emailFooterText')}
            error={form.errors.email_footer}
            tip={translate('emailFooterHelp')}
            status={canEdit ? undefined : translate('clientEmailsAdminOnly')}
          >
            <Textarea
              {...describedBy('client-emails-footer-text', form.errors.email_footer)}
              rows={MAX_FOOTER_LINES}
              disabled={!canEdit}
              value={form.values.email_footer}
              placeholder={translate('emailFooterPlaceholder')}
              onChange={(event) => form.set('email_footer', event.target.value)}
            />
          </FormField>
          {preview && (
            <p
              aria-label={translate('preview')}
              className="text-body-sm whitespace-pre-line text-muted-foreground"
            >
              {preview}
            </p>
          )}
        </FieldGrid>
      </form>
    </SettingsSection>
  )
}
