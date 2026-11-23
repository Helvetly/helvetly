import { translate } from '@/lib/i18n'
import type { MoveChoices, MoveItem, MovePreview } from '@/lib/scheduling'

/** What the person does with a listed session: let it move, keep it where it is, or cancel that date. */
export type MoveChoice = 'move' | 'keep' | 'cancel'

/** Why a session does not simply move, in words. */
export function moveReasonText(item: MoveItem): string {
  switch (item.reason) {
    case 'started':
      return translate('schedMoveStarted')
    case 'closed':
      return translate('schedMoveClosed')
    case 'exception':
      return translate('schedMoveException')
    case 'day_off':
      return item.moves
        ? translate('schedMoveDayOff', { name: item.day_off ?? '' })
        : translate('schedMoveDayOffSkipped', { name: item.day_off ?? '' })
    case 'outside_series':
      return translate('schedMoveOutside')
    case 'request_pending':
      return translate('schedMoveRequest')
    case 'conflict':
      return translate('schedMoveConflict')
    case 'monthly_rule':
      return translate('schedMoveMonthly')
  }
}

/** The ways out for a listed session; none: it is only told (started, closed, outside, the monthly rule). */
export function moveOptions(item: MoveItem): { value: MoveChoice; label: string }[] {
  switch (item.reason) {
    case 'day_off':
      return [
        { value: 'keep', label: translate('schedMoveKeepDay') },
        { value: 'cancel', label: translate('schedMoveSkipDate') },
      ]
    case 'exception':
      return [
        { value: 'keep', label: translate('schedMoveLeave') },
        { value: 'move', label: translate('schedMoveToo') },
      ]
    case 'conflict':
    case 'request_pending':
      return [
        { value: 'move', label: translate('schedMoveAnyway') },
        { value: 'keep', label: translate('schedMoveKeepDay') },
      ]
    default:
      return []
  }
}

/** The proposed choice: what the series would do on its own, except that a session never lands on a day off. */
export function defaultChoice(item: MoveItem): MoveChoice | undefined {
  if (item.reason === 'day_off') return item.moves ? 'keep' : 'cancel'
  if (item.reason === 'exception') return 'keep'
  if (item.reason === 'conflict' || item.reason === 'request_pending') return 'move'
  return undefined
}

export const defaultChoices = (items: MoveItem[]) =>
  Object.fromEntries(
    items.flatMap((item) => {
      const choice = defaultChoice(item)
      return choice ? [[item.occurrence_id, choice]] : []
    }),
  ) as Record<string, MoveChoice>

const movesWith = (item: MoveItem, choice: MoveChoice | undefined) =>
  choice ? choice === 'move' : item.moves

/** How many sessions move and how many do not, with the choices made. */
export function moveCounts(preview: MovePreview, choices: Record<string, MoveChoice>) {
  let moving = preview.moving
  let staying = 0
  for (const item of preview.items) {
    const moves = movesWith(item, choices[item.occurrence_id])
    moving += Number(moves) - Number(item.moves)
    staying += Number(!moves)
  }
  return { moving, staying }
}

/** The ids the API needs for the choices: kept, cancelled, and changed sessions moved too. */
export function choicesBody(items: MoveItem[], choices: Record<string, MoveChoice>): MoveChoices {
  const body: Required<MoveChoices> = { keep: [], cancel: [], include: [] }
  for (const item of items) {
    const choice = choices[item.occurrence_id]
    if (choice === 'keep') body.keep.push(item.occurrence_id)
    if (choice === 'cancel') body.cancel.push(item.occurrence_id)
    if (choice === 'move' && item.reason === 'exception') body.include.push(item.occurrence_id)
  }
  return body
}
