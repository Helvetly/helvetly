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
import { useRef, useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  dayLabel,
  timeLabel,
  weekdayName,
  zoned,
  type MoveChoices,
  type MovePreview,
} from '@/lib/scheduling'

import { Choices, StatusBadge } from './bits'
import {
  choicesBody,
  defaultChoices,
  moveCounts,
  moveOptions,
  moveReasonText,
  type MoveChoice,
} from './move-conflicts-model'
import { weekdayOfDate } from './session-model'

/** "Thursday 20:30": where the moved session goes, from its wall clock. */
const targetLabel = (startsLocal: string) => {
  const [date = '', time = ''] = startsLocal.split('T')
  return `${weekdayName(weekdayOfDate(date), 'long')} ${time.slice(0, 5)}`
}

/**
 * The sessions of a series move that do not simply go along, each with its reason and the ways out; "Move the
 * others" saves with the choices made, Cancel changes nothing.
 */
export function MoveConflictsDialog({
  preview,
  startsLocal,
  zone,
  pending,
  onMove,
  onEditRule,
  onCancel,
}: {
  preview: MovePreview
  /** The moved session's new wall clock, "2026-12-17T20:30". */
  startsLocal: string
  zone: string
  pending: boolean
  onMove: (choices: MoveChoices) => void
  /** Opens the series' repeat rule; without it the monthly rule is only told. */
  onEditRule?: () => void
  onCancel: () => void
}) {
  const [choices, setChoices] = useState(() => defaultChoices(preview.items))
  // Going to the repeat rule: focus stays where onEditRule puts it, not back on what opened this dialog.
  const toRule = useRef(false)
  const { moving, staying } = moveCounts(preview, choices)
  const summary = [
    translate('schedMoveSummary', { moving, target: targetLabel(startsLocal) }),
    staying > 0 && translate('schedMoveSummaryStaying', { count: staying }),
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => toRule.current && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {translate(
              preview.items.some((item) => !item.moves)
                ? 'schedMoveBlockedTitle'
                : 'schedMoveCheckTitle',
            )}
          </DialogTitle>
          <DialogDescription>{translate('schedMoveBlockedText')}</DialogDescription>
        </DialogHeader>
        <p data-move-summary className="text-body-sm font-medium">
          {summary}
        </p>
        <ul className="-mx-1 grid max-h-[50vh] gap-2 overflow-y-auto px-1">
          {preview.items.map((item) => {
            const { date } = zoned(item.starts_at, zone)
            const options = moveOptions(item)
            const choice = choices[item.occurrence_id]
            return (
              <li
                key={item.occurrence_id}
                data-move-item={item.reason}
                className="grid gap-2 rounded-lg border px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-body-sm font-medium">
                    {dayLabel(date)}, {timeLabel(item.starts_at, zone)}
                  </span>
                  <StatusBadge status={item.status} />
                </div>
                <p className="text-body-sm text-muted-foreground">{moveReasonText(item)}</p>
                {options.length > 0 && choice && (
                  <Choices<MoveChoice>
                    label={translate('schedMoveChoice')}
                    value={choice}
                    options={options}
                    onChange={(next) =>
                      setChoices((current) => ({ ...current, [item.occurrence_id]: next }))
                    }
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
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {translate('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => onMove(choicesBody(preview.items, choices))}
            disabled={pending || moving === 0}
          >
            {pending ? translate('saving') : translate('schedMoveOthers')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
