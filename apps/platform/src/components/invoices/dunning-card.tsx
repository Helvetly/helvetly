'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { formatDate } from '@helvetly/ui/lib/format'
import { FileText } from 'lucide-react'
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
        <ul aria-label={translate('remindersSent')} className="mt-3 grid gap-2">
          {data.notices.map((notice) => (
            <li key={notice.level} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="grid min-w-0">
                <a
                  href={localizedHref(noticePdfUrl(invoice.id, notice.level))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-link underline underline-offset-2 hover:no-underline"
                >
                  <FileText aria-hidden className="size-3.5" />
                  {notice.title}
                </a>
                <span className="truncate text-xs text-muted-foreground">
                  {formatDate(notice.sent_on)} · {notice.email}
                  {notice.sent_by ? translate('by', { sent_by: notice.sent_by }) : ''}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
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
  return (
    <span className="flex items-center gap-1">
      {data.paused ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run('resume')}>
          {translate('resume')}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run('pause')}>
          {translate('pause')}
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => run('send')}>
        {translate('send2')}
        {data.next?.title ?? 'reminder'}
        {translate('now')}
      </Button>
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
