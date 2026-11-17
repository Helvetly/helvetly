'use client'
import { TONES } from '@helvetly/ui/components/status-badge'
import { cn } from '@helvetly/ui/lib/utils'
import { QrCode } from 'lucide-react'

import { translate } from '@/lib/i18n'
import {
  formatDay,
  formatMoney,
  fromCents,
  groupReference,
  INSTALMENT_STATUS_LABELS,
  INTERVALS,
  type InstalmentItem,
  type InstalmentStatus,
  type Invoice,
  toCents,
} from '@/lib/invoices'

const TONE: Record<InstalmentStatus, string> = {
  paid: TONES.green,
  part_paid: TONES.amber,
  open: 'bg-muted text-muted-foreground',
  overdue: TONES.red,
  credited: 'bg-muted text-muted-foreground',
}

/** What credit notes took off the instalment. */
const credited = (item: InstalmentItem) => toCents(item.amount) - toCents(item.effective)

/** An invoice's instalments with what each still owes; every one has its own QR bill page. */
export function InstalmentSchedule({
  invoice,
}: {
  invoice: Pick<Invoice, 'instalments' | 'currency' | 'status' | 'payment'>
}) {
  const schedule = invoice.instalments
  if (!schedule) return null
  const interval = INTERVALS.find((entry) => entry.value === schedule.interval)?.label
  return (
    <section
      aria-label={translate('instalments2')}
      className="rounded-xl bg-card px-4 pt-3 pb-4 shadow-elevation-1"
    >
      <div className="flex h-7 items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-muted-foreground">
          {translate('instalments')}
          {schedule.items.length} {interval && `· ${interval.toLowerCase()}`}
        </h3>
        {invoice.payment.qr_bill && (
          <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <QrCode className="size-3.5" />
            {translate('oneQRBillPerInstalment')}
          </span>
        )}
      </div>
      <table className="mt-2 w-full text-[13.5px]">
        <thead className="sr-only">
          <tr>
            <th className="max-sm:hidden">{translate('no')}</th>
            <th>{translate('due')}</th>
            <th>{translate('amount')}</th>
            <th className="max-sm:hidden">{translate('open')}</th>
            <th>{translate('status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {schedule.items.map((item) => (
            <tr key={item.seq}>
              <td className="w-10 py-2 text-muted-foreground tabular-nums max-sm:hidden">
                {item.seq}
              </td>
              <td className="py-2">
                <span className="whitespace-nowrap tabular-nums">{formatDay(item.due_date)}</span>
                {item.reference && (
                  <span className="block font-mono text-[11.5px] text-muted-foreground max-sm:hidden">
                    {groupReference(item.reference)}
                  </span>
                )}
              </td>
              <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums">
                {formatMoney(item.effective, invoice.currency)}
                {credited(item) > 0n && (
                  <span className="block text-xs text-muted-foreground">
                    {translate('instalmentCredited', {
                      amount: formatMoney(fromCents(credited(item)), invoice.currency),
                    })}
                  </span>
                )}
                {/* Phones drop the Open column; a part-paid instalment still says what is left. */}
                {item.status === 'part_paid' && (
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    {translate('open')} {formatMoney(item.open, invoice.currency)}
                  </span>
                )}
              </td>
              <td className="py-2 pl-3 text-right whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
                {item.status === 'paid' || item.status === 'credited'
                  ? '—'
                  : formatMoney(item.open, invoice.currency)}
              </td>
              <td className="py-2 pl-3 text-right">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[12px] whitespace-nowrap',
                    TONE[item.status],
                  )}
                >
                  {INSTALMENT_STATUS_LABELS[item.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
