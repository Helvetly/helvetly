import { languageTag } from '@helvetly/i18n'

const weekdayDay = new Intl.DateTimeFormat(languageTag, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "Thu 20 Nov" for a civil date ("2026-11-20"), as the label a day's entries sit under. */
export const formatDay = (date: string) => weekdayDay.format(new Date(date))

/** Items already sorted by date, grouped by it in the same order. */
export function byDay<T extends { date: string }>(items: T[]) {
  const days: { date: string; items: T[] }[] = []
  for (const item of items) {
    const last = days.at(-1)
    if (last?.date === item.date) last.items.push(item)
    else days.push({ date: item.date, items: [item] })
  }
  return days
}
