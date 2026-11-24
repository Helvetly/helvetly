'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { inputClass } from '@helvetly/ui/components/input'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  instantOf,
  minutesOf,
  useConflicts,
  zoned,
  type MoveChoices,
  type MoveItem,
  type MovePreview,
  type Scope,
} from '@/lib/scheduling'

import { Choices } from './bits'
import {
  decisionCounts,
  decisionSummary,
  decisionsBody,
  defaultDecisions,
  moveOptions,
  moveReasonText,
  overlapText,
  slotLabel,
  whenLabel,
  type Decision,
  type MoveDecision,
} from './move-conflicts-model'

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** "Pick another time…": a date and time for one session, checked as it changes against days off and overlaps. */
function PickTime({
  item,
  at,
  zone,
  hostId,
  now,
  onChange,
}: {
  item: MoveItem
  at: string
  zone: string
  hostId: string | undefined
  /** When the dialog opened: a picked time must come after it. */
  now: number
  onChange: (at: string) => void
}) {
  const id = useId()
  const local = zoned(at, zone)
  const length = Date.parse(item.ends_at) - Date.parse(item.starts_at)
  const past = Date.parse(at) <= now
  const check = useConflicts(
    hostId && !past
      ? {
          host_id: hostId,
          starts_at: at,
          ends_at: new Date(Date.parse(at) + length).toISOString(),
          exclude: item.occurrence_id,
        }
      : null,
  )
  const set = (date: string, minutes: number) =>
    date && onChange(instantOf(date, minutes, zone).toISOString())
  const first = check.data?.[0]
  return (
    <div className="grid gap-1.5" data-move-pick>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-date`} className="sr-only">
          {translate('schedMoveNewDate')}
        </label>
        <input
          id={`${id}-date`}
          type="date"
          value={local.date}
          onChange={(event) => set(event.target.value, local.minutes)}
          className={cn(inputClass, 'w-auto')}
        />
        <label htmlFor={`${id}-time`} className="sr-only">
          {translate('schedMoveNewTime')}
        </label>
        <input
          id={`${id}-time`}
          type="time"
          step={300}
          value={hhmm(local.minutes)}
          onChange={(event) => event.target.value && set(local.date, minutesOf(event.target.value))}
          className={cn(inputClass, 'w-auto')}
        />
      </div>
      <p className="flex items-center gap-1.5 text-body-sm" aria-live="polite">
        {past ? (
          <span className="text-destructive">{translate('schedMovePast')}</span>
        ) : !hostId || check.isFetching ? (
          <span className="text-muted-foreground">{hostId && translate('schedMoveChecking')}</span>
        ) : first ? (
          <>
            <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
            <span className="text-warning">{overlapText(first, zone)}</span>
          </>
        ) : (
          <>
            <CircleCheck className="size-3.5 shrink-0 text-success" aria-hidden />
            <span className="text-success">{translate('schedMoveFree')}</span>
          </>
        )}
      </p>
    </div>
  )
}

/**
 * The sessions of a series move that need a look, each with where it is, where it would go, why it does not simply
 * go along and a decision; Apply saves the move with the decisions in one write, Cancel changes nothing.
 */
export function MoveConflictsDialog({
  preview,
  from,
  to,
  scope,
  zone,
  hostId,
  pending,
  onMove,
  onEditRule,
  onCancel,
}: {
  preview: MovePreview
  /** The dragged session's start, and where it goes (instants). */
  from: string
  to: string
  scope: Scope
  zone: string
  /** The series' host, for checking a time picked by hand. */
  hostId: string | undefined
  pending: boolean
  onMove: (choices: MoveChoices) => void
  /** Opens the series' repeat rule; without it the monthly rule is only told. */
  onEditRule?: () => void
  onCancel: () => void
}) {
  const [decisions, setDecisions] = useState(() => defaultDecisions(preview.items))
  const [now] = useState(Date.now)
  // Going to the repeat rule: focus stays where onEditRule puts it, not back on what opened this dialog.
  const toRule = useRef(false)
  const counts = decisionCounts(preview, decisions)
  const deciding = preview.items.filter((item) => moveOptions(item, zone).length > 0).length
  const clear = preview.moving - preview.items.filter((item) => item.moves).length
  const decide = (id: string, next: Partial<Decision>) =>
    setDecisions((current) => {
      const was = current[id]
      return was ? { ...current, [id]: { ...was, ...next } } : current
    })
  const invalid = Object.values(decisions).some(
    (decision) => decision.kind === 'move_to' && Date.parse(decision.at ?? '') <= now,
  )
  const moves = counts.move + counts.anyway + counts.rescheduled
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent
        className="sm:max-w-xl"
        onCloseAutoFocus={(event) => toRule.current && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {deciding > 0
              ? translate('schedMoveDecideTitle', { count: deciding })
              : translate('schedMoveCheckTitle')}
          </DialogTitle>
          <DialogDescription>
            {translate(scope === 'all' ? 'schedMoveLead' : 'schedMoveLeadFollowing', {
              from: slotLabel(from, zone),
              to: slotLabel(to, zone),
            })}{' '}
            {translate('schedMoveClear', { count: clear })}
          </DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 grid max-h-[55vh] gap-2 overflow-y-auto px-1">
          {preview.items.map((item) => {
            const options = moveOptions(item, zone)
            const decision = decisions[item.occurrence_id]
            return (
              <li
                key={item.occurrence_id}
                data-move-item={item.reason}
                className="grid gap-2 rounded-lg border px-3 py-2.5"
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-medium">
                  <span>{whenLabel(item.starts_at, zone)}</span>
                  {item.moves_to && item.moves_to !== item.starts_at && (
                    <>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="sr-only">{translate('schedMoveTo')}</span>
                      <span>{whenLabel(item.moves_to, zone)}</span>
                    </>
                  )}
                </p>
                <p className="text-body-sm text-muted-foreground">{moveReasonText(item, zone)}</p>
                {options.length > 0 && decision && (
                  <Choices<MoveDecision>
                    label={translate('schedMoveChoice')}
                    value={decision.kind}
                    options={options}
                    onChange={(kind) => decide(item.occurrence_id, { kind })}
                  />
                )}
                {decision?.kind === 'move_to' && (
                  <PickTime
                    item={item}
                    at={decision.at ?? item.starts_at}
                    zone={zone}
                    hostId={hostId}
                    now={now}
                    onChange={(at) => decide(item.occurrence_id, { at })}
                  />
                )}
                {item.reason === 'monthly_rule' && onEditRule && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => {
                      toRule.current = true
                      onEditRule()
                    }}
                    disabled={pending}
                  >
                    {translate('schedMoveEditRule')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        <DialogFooter className="items-center sm:justify-between">
          <p data-move-summary className="text-body-sm text-muted-foreground">
            {decisionSummary(counts)}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              {translate('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => onMove(decisionsBody(preview.items, decisions))}
              disabled={pending || invalid || moves === 0}
            >
              {pending ? translate('saving') : translate('apply')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
