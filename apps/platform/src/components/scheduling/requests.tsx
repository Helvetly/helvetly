'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { EmptyState } from '@helvetly/ui/components/empty-state'
import { inputClass } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { cn } from '@helvetly/ui/lib/utils'
import { Inbox, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadProblem } from '@/components/data/load-problem'
import { TextareaBox } from '@/components/textarea-box'
import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import {
  dayLabel,
  instantOf,
  minutesOf,
  schedulingApi,
  timeLabel,
  useRequests,
  useSchedulingWrite,
  zoned,
  type RequestItem,
  type SchedRequest,
} from '@/lib/scheduling'

const KIND_LABEL = {
  cancel: translate('schedRequestCancel'),
  reschedule: translate('schedRequestReschedule'),
  booking: translate('schedRequestBooking'),
} as const

const done = (message: string) => () => toast.success(message)

/** "Tue, 8 Dec, 09:00" in `zone`. */
export const whenLabel = (instant: string, zone: string) =>
  `${dayLabel(zoned(instant, zone).date)}, ${timeLabel(instant, zone)}`

/** The requests waiting for the business, each answered in place. */
export function RequestsDrawer({
  zone,
  onClose,
  onOpenSession,
}: {
  zone: string
  onClose: () => void
  onOpenSession: (occurrenceId: string) => void
}) {
  const requests = useRequests()
  const list = requests.data ?? []
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(560px,calc(100vw-6rem))]! dark:bg-card"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div className="grid gap-0.5">
            <SheetTitle className="text-lg font-semibold">{translate('schedRequests')}</SheetTitle>
            <SheetDescription className="text-body-sm text-muted-foreground">
              {translate('schedRequestsText')}
            </SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={translate('close')}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {requests.error ? (
            <LoadProblem
              error={requests.error}
              what={translate('schedRequests')}
              onRetry={() => void requests.refetch()}
            />
          ) : !requests.data ? (
            <Loader />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={translate('schedNoRequests')}
              description={translate('schedNoRequestsText')}
            />
          ) : (
            <ul className="grid gap-3">
              {list.map((request) => (
                <li key={request.id}>
                  <RequestCard
                    request={request}
                    zone={zone}
                    onOpenSession={() => onOpenSession(request.occurrence_id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** One request: what the client asked, whether it was late, and the business's answer. */
export function RequestCard({
  request,
  zone,
  onOpenSession,
}: {
  request: RequestItem | (SchedRequest & { occurrence?: undefined })
  zone: string
  onOpenSession?: () => void
}) {
  const canWrite = useCan('write:scheduling')
  const first = request.proposed_times[0] ?? ''
  const [pick, setPick] = useState<string>(first || 'other')
  const [other, setOther] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [taken, setTaken] = useState(false)
  const otherInstant = () => {
    const [date, time] = other.split('T')
    return date && time ? instantOf(date, minutesOf(time), zone).toISOString() : undefined
  }
  const chosen = () => (pick === 'other' ? otherInstant() : pick)
  const approve = useSchedulingWrite((force: boolean) =>
    schedulingApi.approve(
      request.id,
      request.kind === 'reschedule' ? { starts_at: chosen() } : {},
      force,
    ),
  )
  const propose = useSchedulingWrite(() =>
    schedulingApi.propose(request.id, { starts_at: chosen() ?? '' }),
  )
  const decline = useSchedulingWrite(() =>
    schedulingApi.decline(request.id, { reason: reason.trim() || undefined }),
  )
  const pending = approve.isPending || propose.isPending || decline.isPending
  const open = request.status === 'pending'
  const runApprove = (force: boolean) =>
    approve.mutate(force, {
      onSuccess: done(translate('schedRequestApproved')),
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'slot_taken') setTaken(true)
        else toastError(error)
      },
    })

  return (
    <article className="grid gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-body font-medium">{KIND_LABEL[request.kind]}</span>
            {request.late && <Badge tone="amber">{translate('schedLate')}</Badge>}
            {request.status === 'proposed' && (
              <Badge tone="blue">{translate('schedProposalSent')}</Badge>
            )}
          </span>
          {request.occurrence && (
            <span className="truncate text-body-sm text-muted-foreground">
              {request.occurrence.client.name} · {request.occurrence.title} ·{' '}
              {whenLabel(request.occurrence.starts_at, zone)}
            </span>
          )}
        </div>
        {onOpenSession && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={onOpenSession}
          >
            {translate('schedOpenSession')}
          </Button>
        )}
      </header>
      {request.note && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-body-sm">“{request.note}”</p>
      )}
      {request.kind === 'cancel' && (
        <p className="text-body-sm text-muted-foreground">
          {request.late ? translate('schedLateRequestText') : translate('schedOnTimeRequestText')}
        </p>
      )}
      {request.status === 'proposed' && request.staff_proposal && (
        <p className="text-body-sm text-muted-foreground">
          {translate('schedWaitingForClient', { when: whenLabel(request.staff_proposal, zone) })}
        </p>
      )}

      {open && canWrite && request.kind === 'reschedule' && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-body-sm font-medium">{translate('schedNewTime')}</legend>
          {[...request.proposed_times, 'other'].map((time) => (
            <label
              key={time}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-body-sm',
                pick === time && 'border-brand/40 bg-brand/5',
              )}
            >
              <input
                type="radio"
                name={`time-${request.id}`}
                value={time}
                checked={pick === time}
                onChange={() => setPick(time)}
                className="accent-brand"
              />
              {time === 'other' ? translate('schedAnotherTime') : whenLabel(time, zone)}
            </label>
          ))}
          {pick === 'other' && (
            <input
              type="datetime-local"
              aria-label={translate('schedAnotherTime')}
              value={other}
              onChange={(event) => setOther(event.target.value)}
              className={inputClass}
            />
          )}
        </fieldset>
      )}

      {open &&
        canWrite &&
        (declining ? (
          <div className="grid gap-2">
            <TextareaBox
              aria-label={translate('schedReasonOptional')}
              placeholder={translate('schedReasonForClient')}
              rows={2}
              max={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDeclining(false)}
                disabled={pending}
              >
                {translate('cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() =>
                  decline.mutate(undefined, {
                    onSuccess: done(translate('schedRequestDeclined')),
                    onError: toastError,
                  })
                }
              >
                {translate('schedDecline')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeclining(true)}
              disabled={pending}
            >
              {translate('schedDecline')}
            </Button>
            {request.kind === 'reschedule' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || !chosen()}
                onClick={() =>
                  propose.mutate(undefined, {
                    onSuccess: done(translate('schedProposalSentToast')),
                    onError: toastError,
                  })
                }
              >
                {translate('schedPropose')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={pending || (request.kind === 'reschedule' && !chosen())}
              onClick={() => runApprove(false)}
            >
              {request.kind === 'cancel'
                ? request.late
                  ? translate('schedApproveLate')
                  : translate('schedApproveCancel')
                : translate('schedApprove')}
            </Button>
          </div>
        ))}
      {taken && (
        <ConfirmDialog
          title={translate('schedSlotTaken')}
          body={translate('schedSlotTakenText')}
          confirmLabel={translate('schedApproveAnyway')}
          tone="default"
          onDecide={(approved) => {
            setTaken(false)
            if (approved) runApprove(true)
          }}
        />
      )}
    </article>
  )
}
