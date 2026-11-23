'use client'
import { localizedHref } from '@helvetly/i18n'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Mail, Pause, Play, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { errorMessage } from '@/lib/api'
import {
  dunningSummary,
  noticePdfUrl,
  useDunning,
  useDunningAction,
  type Dunning,
  type DunningAction,
} from '@/lib/dunning'
import { translate } from '@/lib/i18n'
import { formatMoney, kindInfo, type Invoice } from '@/lib/invoices'

/** Whether an invoice can have dunning at all: issued, receivable, without instalments of either kind. */
export const dunnable = (invoice: Invoice) =>
  invoice.status !== 'draft' &&
  kindInfo(invoice.kind).receivable &&
  !invoice.instalments &&
  !invoice.plan

const DONE: Record<DunningAction, string> = {
  send: translate('reminderSent'),
  pause: translate('dunningPaused'),
  resume: translate('dunningResumed'),
}

// The viewer's own time zone: when the email actually left, not the invoice's civil day.
const sentAt = new Intl.DateTimeFormat(languageTag, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** "Send reminder", "Send reminder 2", "Send final reminder": the level by its rank, not the letter's title. */
export function sendLabel(next: NonNullable<Dunning['next']>) {
  if (next.level === next.levels) return translate('sendFinalReminder')
  if (next.level === 1) return translate('sendReminder')
  return translate('sendReminderLevel', { level: next.level })
}

/** The invoice's reminders: what goes out next, what was sent (each letter opens), and the actions. */
export function DunningCard({ invoice, canManage }: { invoice: Invoice; canManage: boolean }) {
  const dunning = useDunning(invoice.id)
  const act = useDunningAction(invoice.id)
  if (dunning.isPending) return <Loader label={translate('loadingReminders')} />
  if (dunning.isError)
    return (
      <Section>
        <p className="text-[13px] text-destructive">
          {translate('couldnTLoadTheReminders')}
          {errorMessage(dunning.error)}
        </p>
      </Section>
    )
  const data = dunning.data
  if (!data.next && data.notices.length === 0) return null
  const run = (action: DunningAction) =>
    act.mutate(action, {
      onSuccess: () => toast.success(DONE[action]),
      onError: toastError,
    })
  return (
    <Section
      action={
        canManage && data.next ? <Actions data={data} busy={act.isPending} run={run} /> : null
      }
    >
      <p className="text-[13px] text-muted-foreground">{dunningSummary(data)}</p>
      {data.notices.length > 0 && (
        <ul aria-label={translate('remindersSent')} className="mt-3 grid divide-y divide-border">
          {data.notices.map((notice) => (
            <li key={notice.level} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <Mail className="size-3.5" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <a
                  href={localizedHref(noticePdfUrl(invoice.id, notice.level))}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-body-sm font-medium text-link underline underline-offset-2 hover:no-underline"
                >
                  {notice.title}
                </a>
                <time dateTime={notice.sent_at} className="text-xs text-muted-foreground">
                  {sentAt.format(new Date(notice.sent_at))}
                </time>
                <span className="text-xs break-words text-muted-foreground">
                  {translate('reminderSentTo', { email: notice.email })}
                  {notice.sent_by
                    ? translate('by', { sent_by: notice.sent_by })
                    : translate('sentAutomatically')}
                </span>
                {!notice.confirmed && (
                  <span className="text-xs break-words text-muted-foreground">
                    {translate('reminderDeliveryUnconfirmed')}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right text-body-sm tabular-nums">
                {formatMoney(notice.total, invoice.currency)}
                {notice.fee !== '0.00' && (
                  <span className="block text-xs text-muted-foreground">
                    {translate('fee')}
                    {formatMoney(notice.fee, invoice.currency)}
                  </span>
                )}
                {notice.interest !== '0.00' && (
                  <span className="block text-xs text-muted-foreground">
                    {translate('interest')}
                    {formatMoney(notice.interest, invoice.currency)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Actions({
  data,
  busy,
  run,
}: {
  data: Dunning
  busy: boolean
  run: (action: DunningAction) => void
}) {
  // Pause only stops the automatic run: without one there is nothing to pause.
  const automatic = data.enabled && data.client_enabled
  const toggle = data.paused ? 'resume' : 'pause'
  const next = data.next
  return (
    <span className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A span keeps the tooltip working while the button is disabled. */}
          <span tabIndex={automatic ? undefined : 0}>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !automatic}
              onClick={() => run(toggle)}
            >
              {data.paused ? <Play /> : <Pause />}
              {translate(toggle)}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {!automatic
            ? translate('noAutomaticRemindersToPause')
            : data.paused
              ? translate('resumeAutomaticReminders')
              : translate('pauseAutomaticReminders')}
        </TooltipContent>
      </Tooltip>
      {next && (
        <Button size="sm" disabled={busy} onClick={() => run('send')}>
          <Send />
          {sendLabel(next)}
        </Button>
      )}
    </span>
  )
}

function Section({ action, children }: { action?: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-labelledby="dunning-title"
      className="rounded-xl bg-card px-4 pt-3 pb-4 shadow-elevation-1"
    >
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <h3 id="dunning-title" className="text-[13px] font-medium text-muted-foreground">
          {translate('reminders')}
        </h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}
