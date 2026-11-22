'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  hostColor,
  localOf,
  schedulingApi,
  schedulingKeys,
  STATUS_LABEL,
  STATUS_TONE,
  useSchedulingWrite,
  type EventInput,
  type Occurrence,
  type Scope,
  type Status,
} from '@/lib/scheduling'

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

/** The host's colour, as a small dot before a name. */
export function HostDot({ id, className }: { id: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: hostColor(id) }}
    />
  )
}

export type Choice<T extends string> = { value: T; label: ReactNode; disabledReason?: string }

/** A segmented choice whose options can be unavailable, each saying why in a tooltip. */
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Choice<T>[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset className={cn(segmentTrack, 'flex w-fit flex-wrap')}>
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const button = (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            // Stays focusable while unavailable, so its tooltip can say why.
            aria-disabled={option.disabledReason ? true : undefined}
            onClick={option.disabledReason ? undefined : () => onChange(option.value)}
            className={cn(
              segmentItem,
              'min-h-7',
              option.disabledReason && 'cursor-not-allowed opacity-50',
            )}
          >
            {option.label}
          </button>
        )
        return option.disabledReason ? (
          <Tooltip key={option.value}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{option.disabledReason}</TooltipContent>
          </Tooltip>
        ) : (
          button
        )
      })}
    </fieldset>
  )
}

const SCOPES: { value: Scope; title: string; text: string }[] = [
  { value: 'this', title: translate('schedScopeThis'), text: translate('schedScopeThisText') },
  {
    value: 'following',
    title: translate('schedScopeFollowing'),
    text: translate('schedScopeFollowingText'),
  },
  { value: 'all', title: translate('schedScopeAll'), text: translate('schedScopeAllText') },
]

/** Asks which sessions of a series a change applies to; `onlySeries` leaves out "This session" (a rule change). */
export function SeriesDialog({
  onlySeries = false,
  pending = false,
  onChoose,
  onCancel,
}: {
  onlySeries?: boolean
  pending?: boolean
  onChoose: (scope: Scope) => void
  onCancel: () => void
}) {
  const options = onlySeries ? SCOPES.filter((scope) => scope.value !== 'this') : SCOPES
  const [scope, setScope] = useState<Scope>(options[0]?.value ?? 'this')
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('schedChangeRecurring')}</DialogTitle>
          <DialogDescription>{translate('schedChangeRecurringText')}</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="sr-only">{translate('schedChangeRecurring')}</legend>
          {options.map((option) => (
            <label
              key={option.value}
              className={cn(
                'grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/60',
                scope === option.value && 'border-brand/40 bg-brand/5',
              )}
            >
              <input
                type="radio"
                name="scope"
                value={option.value}
                checked={scope === option.value}
                onChange={() => setScope(option.value)}
                className="mt-1 accent-brand"
              />
              <span className="text-body-sm font-medium">{option.title}</span>
              <span className="col-start-2 text-body-sm text-muted-foreground">{option.text}</span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {translate('cancel')}
          </Button>
          <Button type="button" onClick={() => onChoose(scope)} disabled={pending}>
            {pending ? translate('saving') : translate('schedApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** After a change to a series: how many changed sessions kept their own time. */
export function toastSaved(kept: number | undefined) {
  toast.success(
    kept ? translate('schedSavedKept', { count: kept }) : translate('schedSessionSaved'),
  )
}

/**
 * Saves a change to one session, asking for the scope first when it belongs to a series. `dialog` is the series
 * dialog while it is open; render it.
 */
export function useSessionChange() {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<{
    occurrence: Occurrence
    body: Partial<EventInput>
    onlySeries: boolean
    done?: () => void
  } | null>(null)
  const patch = useSchedulingWrite(
    ({ id, body }: { id: string; body: Partial<EventInput> & { scope: Scope } }) =>
      schedulingApi.patchOccurrence(id, body),
  )
  const save = (
    occurrence: Occurrence,
    body: Partial<EventInput>,
    scope: Scope,
    done?: () => void,
  ) =>
    patch.mutate(
      { id: occurrence.id, body: { ...body, scope } },
      {
        onSuccess: (answer) => {
          setAsking(null)
          toastSaved(answer.details?.kept)
          done?.()
        },
        onError: (error) => {
          setAsking(null)
          toast.error(errorMessage(error))
        },
      },
    )
  const change = async (
    occurrence: Occurrence,
    body: Partial<EventInput>,
    { onlySeries = false, done }: { onlySeries?: boolean; done?: () => void } = {},
  ) => {
    const event = await queryClient.fetchQuery({
      queryKey: schedulingKeys.event(occurrence.event_id),
      queryFn: () => schedulingApi.event(occurrence.event_id),
    })
    if (event.recurrence) setAsking({ occurrence, body, onlySeries, done })
    else save(occurrence, body, 'this', done)
  }
  /** Moves a session to new instants, written as the series' wall clock. */
  const move = async (occurrence: Occurrence, startsAt: Date, endsAt: Date) => {
    try {
      const event = await queryClient.fetchQuery({
        queryKey: schedulingKeys.event(occurrence.event_id),
        queryFn: () => schedulingApi.event(occurrence.event_id),
      })
      await change(occurrence, {
        starts_local: localOf(startsAt, event.time_zone),
        duration_minutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
      })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const dialog = asking && (
    <SeriesDialog
      onlySeries={asking.onlySeries}
      pending={patch.isPending}
      onCancel={() => setAsking(null)}
      onChoose={(scope) => save(asking.occurrence, asking.body, scope, asking.done)}
    />
  )
  return { change, move, dialog, pending: patch.isPending }
}
