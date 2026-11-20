'use client'

import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { BookCheck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { inputClass } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { errorMessage } from '@/lib/api'
import { formatPay } from '@/lib/employees'
import { translate } from '@/lib/i18n'
import {
  BOOKING_FORMATS,
  bookingExportUrl,
  monthPeriod,
  useBook,
  useBookingPreview,
  useBookings,
} from '@/lib/payroll'

import { DisabledTip, useHrAccess } from './hr-access'

const KIND_LABELS = {
  accrual: translate('payrollKindAccrual'),
  reversal: translate('payrollKindReversal'),
  payment: translate('payrollKindPayment'),
}

/** What the next payroll journal would post up to a date, booking it, and the bookings made so far. */
export function BookingsSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const [upTo, setUpTo] = useState(() => monthPeriod(month).end)
  const preview = useBookingPreview(upTo, upTo !== '')
  const past = useBookings(true)
  const book = useBook()
  const hr = useHrAccess()
  const items = preview.data?.items ?? []
  const ready = items.filter((item) => !item.blocked).length

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto p-0 sm:w-[min(640px,100vw)]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{translate('payrollBookings')}</SheetTitle>
        <SheetDescription className="sr-only">
          {translate('payrollBookingsDescription')}
        </SheetDescription>
        <header className="flex items-start gap-3 border-b px-5 py-4 md:px-6">
          <div className="grid flex-1 gap-0.5">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">
              {translate('payrollBookings')}
              <HelpTip label={translate('payrollBookingsLabel')}>
                {translate('payrollBookingsTip')}
              </HelpTip>
            </h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={translate('close')}
                onClick={onClose}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('close')}</TooltipContent>
          </Tooltip>
        </header>

        <section className="grid gap-3 border-b px-5 py-5 md:px-6">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1.5 text-body-sm font-medium">
              {translate('payrollUpTo')}
              <input
                type="date"
                value={upTo}
                onChange={(event) => setUpTo(event.target.value)}
                className={cn(inputClass, 'w-44')}
              />
            </label>
            {hr.seesPayrollWrites && (
              <span className="ml-auto">
                <DisabledTip reason={hr.lockReason}>
                  <Button
                    disabled={ready === 0 || book.isPending || Boolean(hr.lockReason)}
                    onClick={() =>
                      book.mutate(upTo, {
                        onSuccess: (booking) =>
                          toast.success(translate('payrollLinesBooked', { count: booking.items })),
                        onError: (error) => toast.error(errorMessage(error)),
                      })
                    }
                  >
                    <BookCheck /> {translate('payrollBook', { count: ready })}
                  </Button>
                </DisabledTip>
              </span>
            )}
          </div>
          {preview.error ? (
            <p role="alert" className="text-sm text-destructive">
              {loadProblemText(preview.error, translate('payrollThePreview'))}
            </p>
          ) : !preview.data ? (
            <Loader className="min-h-24" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{translate('payrollNothingToBook')}</p>
          ) : (
            <ul
              aria-label={translate('payrollToBook')}
              className="divide-y rounded-lg ring-1 ring-border"
            >
              {items.map((item) => (
                <li key={`${item.entry.id}-${item.kind}`} className="grid gap-1 px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-2 text-body">
                    <span className="min-w-0 flex-1 truncate">{item.entry.employee_name}</span>
                    <Badge tone={item.blocked ? 'amber' : 'green'}>{KIND_LABELS[item.kind]}</Badge>
                    <span className="text-body-sm text-muted-foreground">
                      {formatDate(item.date)}
                    </span>
                    <span className="tabular-nums">
                      {formatPay(
                        item.kind === 'payment' ? item.entry.net : item.entry.total_cost,
                        item.entry.currency,
                      )}
                    </span>
                  </span>
                  {item.blocked && (
                    <span className="text-body-sm text-warning">
                      {translate('payrollBlocked', { reason: item.blocked })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-2 px-5 py-5 md:px-6">
          <h3 className="text-title-sm font-semibold">{translate('payrollPastBookings')}</h3>
          {past.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">{translate('payrollNothingBooked')}</p>
          )}
          <ul className="divide-y">
            {past.data?.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center gap-2 py-2 text-body">
                <span className="flex-1">
                  {translate('payrollBookingLine', {
                    date: formatDate(booking.up_to),
                    count: booking.items,
                  })}
                </span>
                {BOOKING_FORMATS.map((format) => (
                  <a
                    key={format.value}
                    href={bookingExportUrl(booking.id, format.value)}
                    aria-label={translate('payrollDownloadBooking', {
                      date: formatDate(booking.up_to),
                      format: format.label,
                    })}
                    className="text-body-sm text-link underline underline-offset-4 hover:no-underline"
                  >
                    {format.label}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      </SheetContent>
    </Sheet>
  )
}
