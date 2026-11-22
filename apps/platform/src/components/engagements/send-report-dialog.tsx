'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { inputClass as fieldClass } from '@/components/clients/fields'
import { EmailMessageField } from '@/components/email-message-field'
import { emails, fieldErrors, recipientErrors } from '@/components/invoices/invoice-dialogs'
import { RecipientFields } from '@/components/recipient-fields'
import { errorMessage } from '@/lib/api'
import { getEngagement, periodLabel, sendReport, type PeriodSummary } from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

/** E-mails the period's service report (PDF) to the client. */
export function SendReportDialog({
  engagementId,
  period,
  defaultTo,
  open,
  onOpenChange,
}: {
  engagementId: string
  period: PeriodSummary
  defaultTo: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const engagement = useQuery({
    queryKey: [...queryKeys.engagements, engagementId],
    queryFn: async () => (await getEngagement(engagementId)).data,
  }).data
  const [to, setTo] = useState<string | null>(null)
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const recipients = to ?? defaultTo ?? ''
  const defaultSubject = translate('serviceReport', {
    value1: engagement?.title ?? '',
    value2: periodLabel(period),
  })
  const send = useMutation({
    mutationFn: (body: Parameters<typeof sendReport>[2]) =>
      sendReport(engagementId, period.id, body),
    onSuccess: ({ to: sent }) => {
      toast.success(translate('serviceReportSentTo', { value1: sent.join(', ') }))
      onOpenChange(false)
    },
    onError: (error: unknown) => {
      const fromServer = fieldErrors(error)
      if (Object.keys(fromServer).length) setErrors(fromServer)
      else toast.error(errorMessage(error))
    },
  })

  const submit = () => {
    const list = emails(recipients)
    const found = recipientErrors(recipients, cc, bcc)
    setErrors(found)
    if (Object.keys(found).length) return
    send.mutate({
      to: list,
      ...(emails(cc).length ? { cc: emails(cc) } : {}),
      ...(emails(bcc).length ? { bcc: emails(bcc) } : {}),
      subject: (subject ?? defaultSubject).trim(),
      ...(message.trim() ? { message: message.trim() } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(440px,calc(100vw-2rem))] max-w-none! gap-0 rounded-2xl p-0">
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-1 px-6 pt-6">
            <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
              {translate('sendServiceReport')}
            </DialogTitle>
            <DialogDescription className="text-[13.5px]">
              {engagement?.client.name ?? translate('theClient')}
              {translate('receivesTheReportFor')} {periodLabel(period)}
              {translate('asAPDF')}
            </DialogDescription>
          </div>
          <div className="grid gap-4 px-6 pt-5 pb-6">
            <RecipientFields
              id="report"
              to={recipients}
              onToChange={setTo}
              toTip={translate('separateSeveralAddressesWithCommasDefaultsToTheClient')}
              toPlaceholder={translate('accountsClientCh')}
              cc={cc}
              onCcChange={setCc}
              bcc={bcc}
              onBccChange={setBcc}
              errors={errors}
            />
            <FormField id="report-subject" label={translate('subject')} error={errors.subject}>
              <input
                {...describedBy('report-subject', errors.subject)}
                value={subject ?? defaultSubject}
                onChange={(event) => setSubject(event.target.value)}
                className={fieldClass}
              />
            </FormField>
            <EmailMessageField
              id="report-message"
              error={errors.message}
              value={message}
              onChange={setMessage}
              placeholder={translate('optionalAShortNoteAboveTheAttachedReport')}
              context={{
                document: translate('serviceReport', {
                  value1: engagement?.title ?? '',
                  value2: periodLabel(period),
                }),
                client: engagement?.client.name,
                subject: subject ?? defaultSubject,
              }}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-border/70 px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              className="ml-auto"
              onClick={() => onOpenChange(false)}
            >
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? translate('working') : translate('send')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
