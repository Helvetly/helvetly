'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useState } from 'react'

import { monthLabel, PERIODS_KEY, useCloseMonths } from '@/components/settings/periods-settings'
import { booksApi } from '@/lib/books'
import { translate } from '@/lib/i18n'
import type { ImportRecord, ImportValue } from '@/lib/imports'
import { toCents, today } from '@/lib/invoices'
import { useCan } from '@/lib/permissions'

const text = (value: ImportValue | undefined) => (typeof value === 'string' ? value : '')

/** The invoice's issue date and the payment dates that the import books. */
function bookedDates(data: ImportRecord['data']): string[] {
  const issued = text(data.issue_date)
  const rows = Array.isArray(data.instalments) ? data.instalments : []
  const paid = rows.filter((row) => row.paid !== false && text(row.paid_on) !== '')
  const amount = text(data.paid_amount)
  const totalPaid = amount ? toCents(amount) : 0n
  const instalmentsPaid = paid.reduce((sum, row) => sum + toCents(text(row.amount)), 0n)
  const dates =
    paid.length > 0 && (!amount || totalPaid === instalmentsPaid)
      ? paid.map((row) => text(row.paid_on))
      : totalPaid > 0n
        ? [text(data.paid_on)]
        : []
  return [issued, ...dates].filter(Boolean)
}

/**
 * The open months to close after creating these records' invoices issued elsewhere: every ended month from the
 * earliest to the latest one they are booked in, oldest first, so no gap stays open inside the imported history.
 */
export function importedMonthsToClose(
  records: ImportRecord[],
  closed: ReadonlySet<string>,
  todayIso: string,
): string[] {
  const months = records
    .filter((r) => r.kind === 'invoices' && r.data.issued_elsewhere === true)
    .flatMap((r) => bookedDates(r.data).map((date) => date.slice(0, 7)))
    .toSorted()
  const current = todayIso.slice(0, 7)
  const first = months[0]
  const last = months.findLast((month) => month < current)
  if (!first || !last || first > last) return []
  const out: string[] = []
  for (let d = new Date(`${first}-01T00:00:00Z`); ; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const month = d.toISOString().slice(0, 7)
    if (month > last) return out
    if (!closed.has(month)) out.push(month)
  }
}

/** After importing past invoices (`created`): offer to close the months they filled, once the person confirms. */
export function CloseImportedMonths({ created }: { created: ImportRecord[] }) {
  const canClose = useCan('write:periods')
  const [dismissed, setDismissed] = useState(false)
  const periods = useQuery({
    queryKey: PERIODS_KEY,
    queryFn: async () => (await booksApi.periods()).data,
    enabled: canClose,
  })
  const close = useCloseMonths()
  if (!canClose || dismissed || !periods.data) return null
  const months = importedMonthsToClose(created, new Set(periods.data.map((p) => p.month)), today())
  if (!months.length) return null
  const first = monthLabel(months[0] ?? '')
  const last = monthLabel(months.at(-1) ?? '')
  return (
    <Callout
      tone="info"
      title={translate('importCloseMonthsTitle')}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setDismissed(true)}>
            {translate('notNow')}
          </Button>
          <Button size="sm" disabled={close.isPending} onClick={() => close.mutate(months)}>
            <Lock />
            {translate('importCloseMonths', { count: months.length })}
          </Button>
        </>
      }
    >
      {translate('importCloseMonthsBody', {
        range: months.length === 1 ? first : `${first} – ${last}`,
      })}
    </Callout>
  )
}
