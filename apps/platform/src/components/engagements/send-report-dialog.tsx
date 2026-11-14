'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { inputClass as fieldClass } from '@/components/clients/fields'
import { errorMessage } from '@/lib/api'
import { getEngagement, periodLabel, sendReport, type PeriodSummary } from '@/lib/engagements'
import { queryKeys } from '@/lib/queries'

const emails = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const [subject, setSubject] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const recipients = to ?? defaultTo ?? ''
  const defaultSubject = `Service report – ${engagement?.title ?? ''} – ${periodLabel(period)}`
  const send = useMutation({
    mutationFn: (body: Parameters<typeof sendReport>[2]) =>
      sendReport(engagementId, period.id, body),
    onSuccess: ({ to: sent }) => {
      toast.success(`Service report sent to ${sent.join(', ')}.`)
      onOpenChange(false)
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  })

  const submit = () => {
    const list = emails(recipients)
    const copies = emails(cc)
    const bad = [...list, ...copies].find((address) => !EMAIL.test(address))
    const found: Record<string, string> = {}
    if (list.length === 0) found.to = 'Add at least one email address.'
    else if (list.length > 10) found.to = 'At most 10 recipients.'
    else if (bad) found.to = `“${bad}” isn’t an email address.`
    if (copies.length > 10) found.cc = 'At most 10 addresses in Cc.'
    setErrors(found)
    if (Object.keys(found).length) return
    send.mutate({
      to: list,
      ...(copies.length ? { cc: copies } : {}),
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
              Send service report
            </DialogTitle>
            <DialogDescription className="text-[13.5px]">
              {engagement?.client.name ?? 'The client'} receives the report for{' '}
              {periodLabel(period)} as a PDF.
            </DialogDescription>
          </div>
          <div className="grid gap-4 px-6 pt-5 pb-6">
            <FormField
              id="report-to"
              label="To"
              required
              error={errors.to}
              tip="Separate several addresses with commas. Defaults to the client’s billing email."
            >
              <input
                {...describedBy('report-to', errors.to)}
                type="email"
                multiple
                value={recipients}
                onChange={(event) => setTo(event.target.value)}
                placeholder="accounts@client.ch"
                className={fieldClass}
              />
            </FormField>
            <FormField id="report-cc" label="Cc" error={errors.cc}>
              <input
                {...describedBy('report-cc', errors.cc)}
                type="email"
                multiple
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                placeholder="Optional"
                className={fieldClass}
              />
            </FormField>
            <FormField id="report-subject" label="Subject">
              <input
                {...describedBy('report-subject')}
                value={subject ?? defaultSubject}
                onChange={(event) => setSubject(event.target.value)}
                className={fieldClass}
              />
            </FormField>
            <FormField id="report-message" label="Message">
              <textarea
                {...describedBy('report-message')}
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Optional. A short note above the attached report."
                className={cn(fieldClass, 'h-auto resize-y py-2 leading-relaxed')}
              />
            </FormField>
          </div>
          <div className="flex items-center gap-2 border-t border-border/70 px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              className="ml-auto"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? 'Working…' : 'Send'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
