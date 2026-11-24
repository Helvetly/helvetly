'use client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  changeErrorMessage,
  instantOf,
  minutesOf,
  localOf,
  schedulingApi,
  schedulingKeys,
  useSchedulingWrite,
  type EventInput,
  type MoveChoices,
  type MovePreview,
  type Occurrence,
  type Scope,
} from '@/lib/scheduling'

import { SeriesDialog } from './bits'
import { MoveConflictsDialog } from './move-conflicts'

/** After a change to a series: how many changed sessions kept their own time. */
export function toastSaved(kept: number | undefined) {
  toast.success(
    kept ? translate('schedSavedKept', { count: kept }) : translate('schedSessionSaved'),
  )
}

/** The instant of a wall clock "2026-12-17T20:30" in zone. */
const instantOfLocal = (local: string, zone: string) => {
  const [date = '', time = '00:00'] = local.split('T')
  return instantOf(date, minutesOf(time), zone).toISOString()
}

type Change = { occurrence: Occurrence; body: Partial<EventInput>; zone: string; done?: () => void }

/**
 * Saves a change to one session, asking for the scope first when it belongs to a series. A new time for this and
 * the following, or all sessions is previewed first: when some sessions do not simply go along, a dialog lists them
 * with the ways out before anything is saved. `dialog` is whichever dialog is open; render it. `onEditRule` opens
 * the series' repeat rule (offered when its day of the month cannot move by days).
 */
export function useSessionChange({
  onEditRule,
}: { onEditRule?: (occurrence: Occurrence) => void } = {}) {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<(Change & { onlySeries: boolean }) | null>(null)
  const [blocked, setBlocked] = useState<(Change & { scope: Scope; preview: MovePreview }) | null>(
    null,
  )
  const [previewing, setPreviewing] = useState(false)
  const patch = useSchedulingWrite(
    ({ id, body }: { id: string; body: Partial<EventInput> & { scope: Scope } & MoveChoices }) =>
      schedulingApi.patchOccurrence(id, body),
  )
  const close = () => {
    setAsking(null)
    setBlocked(null)
  }
  const commit = ({ occurrence, body, done }: Change, scope: Scope, choices: MoveChoices = {}) =>
    patch.mutate(
      { id: occurrence.id, body: { ...body, ...choices, scope } },
      {
        onSuccess: (answer) => {
          close()
          toastSaved(answer.details?.kept)
          done?.()
        },
        onError: (error) => {
          close()
          toast.error(changeErrorMessage(error))
        },
      },
    )
  const save = async (change: Change, scope: Scope) => {
    if (scope === 'this' || !change.body.starts_local) return commit(change, scope)
    setPreviewing(true)
    try {
      const preview = await schedulingApi.previewMove(change.occurrence.id, {
        ...change.body,
        scope,
      })
      if (preview.items.length === 0) return commit(change, scope)
      setAsking(null)
      setBlocked({ ...change, scope, preview })
    } catch (error) {
      close()
      toast.error(changeErrorMessage(error))
    } finally {
      setPreviewing(false)
    }
  }
  const change = async (
    occurrence: Occurrence,
    body: Partial<EventInput>,
    { onlySeries = false, done }: { onlySeries?: boolean; done?: () => void } = {},
  ) => {
    const event = await queryClient.fetchQuery({
      queryKey: schedulingKeys.event(occurrence.event_id),
      queryFn: () => schedulingApi.event(occurrence.event_id),
    })
    const pending = { occurrence, body, zone: event.time_zone, done }
    if (event.recurrence) setAsking({ ...pending, onlySeries })
    else void save(pending, 'this')
  }
  /** Moves a session to new instants, written as the series' wall clock. */
  const move = async (
    occurrence: Occurrence,
    startsAt: Date,
    endsAt: Date,
    extra: Partial<EventInput> = {},
  ) => {
    try {
      const event = await queryClient.fetchQuery({
        queryKey: schedulingKeys.event(occurrence.event_id),
        queryFn: () => schedulingApi.event(occurrence.event_id),
      })
      await change(occurrence, {
        starts_local: localOf(startsAt, event.time_zone),
        duration_minutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
        ...extra,
      })
    } catch (error) {
      toast.error(changeErrorMessage(error))
    }
  }
  const pending = patch.isPending || previewing
  const dialog = (
    <>
      {asking && (
        <SeriesDialog
          onlySeries={asking.onlySeries}
          pending={pending}
          onCancel={() => setAsking(null)}
          onChoose={(scope) => void save(asking, scope)}
        />
      )}
      {blocked && (
        <MoveConflictsDialog
          preview={blocked.preview}
          from={blocked.occurrence.starts_at}
          to={instantOfLocal(blocked.body.starts_local ?? '', blocked.zone)}
          scope={blocked.scope}
          zone={blocked.zone}
          hostId={blocked.body.host_id ?? blocked.occurrence.host?.id}
          pending={patch.isPending}
          onCancel={() => setBlocked(null)}
          onMove={(choices) => commit(blocked, blocked.scope, choices)}
          onEditRule={
            onEditRule &&
            (() => {
              setBlocked(null)
              // After the dialog is gone: while open, its focus trap keeps focus inside it.
              setTimeout(() => onEditRule(blocked.occurrence), 0)
            })
          }
        />
      )}
    </>
  )
  return { change, move, dialog, pending }
}
