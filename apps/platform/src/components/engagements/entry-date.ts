import { formatDate } from '@helvetly/ui/lib/format'

import type { Engagement } from '@/lib/engagements'
import { translate } from '@/lib/i18n'

/** The days an entry may fall on, as the API checks them: from the start, up to today and the engagement's last day. */
export function entryDateBounds(
  engagement: Pick<Engagement, 'start_date' | 'end_date' | 'cancelled_on'>,
  today: string,
) {
  const last = [engagement.end_date, engagement.cancelled_on]
    .filter((day): day is string => day !== null)
    .toSorted()[0]
  return { min: engagement.start_date, max: last && last < today ? last : today, last }
}

/** Why an entry cannot fall on `date`, in the API's words; null when it can. */
export function entryDateProblem(
  date: string,
  { min, max, last }: ReturnType<typeof entryDateBounds>,
): string | null {
  if (!date) return translate('enterADate')
  if (date < min) return translate('pickADateFromTheEngagementStart', { date: formatDate(min) })
  if (date <= max) return null
  return last === max
    ? translate('pickADateUpToTheEngagementEnd', { date: formatDate(max) })
    : translate('pickADateUpToToday', { date: formatDate(max) })
}
