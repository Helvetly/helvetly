'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Ban, CalendarX2, Check, Undo2, UserX } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { TextareaBox } from '@/components/textarea-box'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'
import {
  defaultCancelAs,
  isOpen,
  schedulingApi,
  useSchedSettings,
  useSchedulingWrite,
  type Occurrence,
  type Scope,
} from '@/lib/scheduling'

type Dialogs = 'cancel' | 'waive' | null

/** The drawer header's status actions for one session: attended, no-show, cancel, waive, undo. */
export function StatusActions({
  occurrence,
  recurring,
  now,
}: {
  occurrence: Occurrence
  recurring: boolean
  now: Date
}) {
  const role = useSession().data?.role
  const canWrite = useCan('write:scheduling')
  const canLog = useCan('write:engagements')
  const [dialog, setDialog] = useState<Dialogs>(null)
  const attendance = useSchedulingWrite(
    (body: { status?: 'attended' | 'no_show' | 'scheduled'; waive?: boolean; reason?: string }) =>
      schedulingApi.attendance(occurrence.id, body),
  )
  if (!canWrite) return null

  const started = Date.parse(occurrence.starts_at) <= now.getTime()
  const open = isOpen(occurrence.status)
  // Counting on an engagement adds an entry there, which needs its own permission.
  const blocked =
    occurrence.engagement && !canLog ? translate('schedNeedsEngagementWrite') : undefined
  const notYet = started ? undefined : translate('schedNotStartedYet')
  const mark = (status: 'attended' | 'no_show' | 'scheduled', message: string) =>
    attendance.mutate({ status }, { onSuccess: () => toast.success(message), onError: toastError })
  const canWaive =
    (role === 'owner' || role === 'admin') &&
    occurrence.counts &&
    !occurrence.waived &&
    (occurrence.status === 'no_show' || occurrence.status === 'cancelled_late')

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open && (
        <>
          <Action
            icon={<Check />}
            label={translate('schedMarkAttended')}
            reason={notYet ?? blocked}
            pending={attendance.isPending}
            onClick={() => mark('attended', translate('schedMarkedAttended'))}
          />
          <Action
            icon={<UserX />}
            label={translate('schedNoShow')}
            reason={notYet ?? blocked}
            pending={attendance.isPending}
            onClick={() => mark('no_show', translate('schedMarkedNoShow'))}
          />
          <Action
            icon={<CalendarX2 />}
            label={translate('schedCancelSession')}
            onClick={() => setDialog('cancel')}
          />
        </>
      )}
      {(occurrence.status === 'attended' || occurrence.status === 'no_show') && (
        <Action
          icon={<Undo2 />}
          label={translate('schedUndoAttendance')}
          reason={blocked}
          pending={attendance.isPending}
          onClick={() => mark('scheduled', translate('schedAttendanceUndone'))}
        />
      )}
      {canWaive && (
        <Action icon={<Ban />} label={translate('schedWaive')} onClick={() => setDialog('waive')} />
      )}

      {dialog === 'cancel' && (
        <CancelDialog
          occurrence={occurrence}
          recurring={recurring}
          now={now}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'waive' && (
        <WaiveDialog
          pending={attendance.isPending}
          onDecide={(reason) => {
            if (reason === null) return setDialog(null)
            attendance.mutate(
              { waive: true, reason: reason || undefined },
              {
                onSuccess: () => {
                  setDialog(null)
                  toast.success(translate('schedWaived'))
                },
                onError: (error) => {
                  setDialog(null)
                  toastError(error)
                },
              },
            )
          }}
        />
      )}
    </div>
  )
}

function Action({
  icon,
  label,
  reason,
  pending,
  onClick,
}: {
  icon: ReactNode
  label: string
  reason?: string
  pending?: boolean
  onClick: () => void
}) {
  if (!reason)
    return (
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClick}>
        {icon}
        {label}
      </Button>
    )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Stays focusable while it cannot run, so its tooltip can say why. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled
          className="cursor-not-allowed opacity-50"
        >
          {icon}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  )
}

/** Cancels on time or late (the policy's answer chosen), for this session or more of its series. */
function CancelDialog({
  occurrence,
  recurring,
  now,
  onClose,
}: {
  occurrence: Occurrence
  recurring: boolean
  now: Date
  onClose: () => void
}) {
  const settings = useSchedSettings().data
  const [as, setAs] = useState<'on_time' | 'late' | null>(null)
  const [scope, setScope] = useState<Scope>('this')
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)
  const chosen = as ?? defaultCancelAs(occurrence, settings, now.getTime())
  const cancel = useSchedulingWrite(() =>
    schedulingApi.cancel(occurrence.id, {
      scope,
      as: chosen,
      reason: reason.trim() || undefined,
      notify,
    }),
  )
  return (
    <Dialog open onOpenChange={(open) => !open && !cancel.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('schedCancelThisSession')}</DialogTitle>
          <DialogDescription>{translate('schedCancelText')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <span className="text-body-sm font-medium">{translate('schedCancelledAs')}</span>
            <Segmented
              label={translate('schedCancelledAs')}
              value={chosen}
              fill
              options={[
                { value: 'on_time', label: translate('schedOnTime') },
                { value: 'late', label: translate('schedLate') },
              ]}
              onChange={setAs}
            />
            <p className="text-body-sm text-muted-foreground">
              {chosen === 'late'
                ? settings?.late_cancel_counts === false
                  ? translate('schedLateDoesNotCount')
                  : translate('schedLateCounts')
                : translate('schedOnTimeDoesNotCount')}
            </p>
          </div>
          {recurring && (
            <div className="grid gap-1.5">
              <span className="text-body-sm font-medium">{translate('schedWhichSessions')}</span>
              <Segmented
                label={translate('schedWhichSessions')}
                value={scope}
                fill
                options={[
                  { value: 'this', label: translate('schedScopeThis') },
                  { value: 'following', label: translate('schedScopeFollowing') },
                  { value: 'all', label: translate('schedScopeAll') },
                ]}
                onChange={setScope}
              />
            </div>
          )}
          <TextareaBox
            aria-label={translate('schedReasonOptional')}
            placeholder={translate('schedReasonOptional')}
            rows={2}
            max={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <label className="flex items-center gap-2 text-body-sm">
            <Checkbox checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} />
            {translate('schedEmailClient')}
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            {translate('schedKeepSession')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, {
                onSuccess: () => {
                  onClose()
                  toast.success(translate('schedSessionCancelled'))
                },
                onError: toastError,
              })
            }
          >
            {cancel.isPending ? translate('saving') : translate('schedCancelSession')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Stops a no-show or late cancellation from counting; `onDecide(null)` when kept. */
function WaiveDialog({
  pending,
  onDecide,
}: {
  pending: boolean
  onDecide: (reason: string | null) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <ConfirmDialog
      title={translate('schedWaiveTitle')}
      body={translate('schedWaiveText')}
      confirmLabel={pending ? translate('saving') : translate('schedWaive')}
      tone="default"
      onDecide={(approved) => onDecide(approved ? reason.trim() : null)}
    >
      <TextareaBox
        aria-label={translate('schedReasonOptional')}
        placeholder={translate('schedReasonOptional')}
        rows={2}
        max={500}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </ConfirmDialog>
  )
}
