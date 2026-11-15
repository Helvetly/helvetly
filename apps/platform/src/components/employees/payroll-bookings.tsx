'use client'

import { Button } from '@helvetly/ui/components/button'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
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
import {
  BOOKING_FORMATS,
  bookingExportUrl,
  monthPeriod,
  useBook,
  useBookingPreview,
  useBookings,
} from '@/lib/payroll'
import { useCan } from '@/lib/permissions'

const KIND_LABELS = { accrual: 'Accrual', reversal: 'Reversal', payment: 'Payment' }

/** What the next payroll journal would post up to a date, booking it, and the bookings made so far. */
export function BookingsSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const [upTo, setUpTo] = useState(() => monthPeriod(month).end)
  const preview = useBookingPreview(upTo, upTo !== '')
  const past = useBookings(true)
  const book = useBook()
  const canBook = useCan('write:payroll-export')
  const items = preview.data?.items ?? []
  const ready = items.filter((item) => !item.blocked).length

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto p-0 sm:w-[min(640px,100vw)]! dark:bg-card"
      >
        <SheetTitle className="sr-only">Bookings</SheetTitle>
        <SheetDescription className="sr-only">Payroll journal for your books</SheetDescription>
        <header className="flex items-start gap-3 border-b px-5 py-4 md:px-6">
          <div className="grid flex-1 gap-0.5">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">
              Bookings
              <HelpTip label="About bookings">
                Approved entries become journal lines (salary, employer costs, net pay and
                deductions payable, bank). Each entry is booked once; download a booking for your
                accounting.
              </HelpTip>
            </h2>
            <p className="text-[13px] text-muted-foreground">
              Approved figures only, in the base currency.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </header>

        <section className="grid gap-3 border-b px-5 py-5 md:px-6">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1.5 text-body-sm font-medium">
              Up to
              <input
                type="date"
                value={upTo}
                onChange={(event) => setUpTo(event.target.value)}
                className={cn(inputClass, 'w-44')}
              />
            </label>
            {canBook && (
              <Button
                className="ml-auto"
                disabled={ready === 0 || book.isPending}
                onClick={() =>
                  book.mutate(upTo, {
                    onSuccess: (booking) => toast.success(`${booking.items} lines booked.`),
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
              >
                <BookCheck /> Book {ready > 0 ? ready : ''}
              </Button>
            )}
          </div>
          {preview.error ? (
            <p role="alert" className="text-sm text-destructive">
              {loadProblemText(preview.error, 'The preview')}
            </p>
          ) : !preview.data ? (
            <Loader className="min-h-24" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to book up to this date.</p>
          ) : (
            <ul aria-label="To book" className="divide-y rounded-lg ring-1 ring-border">
              {items.map((item) => (
                <li key={`${item.entry.id}-${item.kind}`} className="grid gap-1 px-3 py-2.5">
                  <span className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="min-w-0 flex-1 truncate">{item.entry.employee_name}</span>
                    <StatusBadge tone={item.blocked ? 'amber' : 'green'}>
                      {KIND_LABELS[item.kind]}
                    </StatusBadge>
                    <span className="text-[13px] text-muted-foreground">
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
                    <span className="text-[13px] text-warning">Blocked: {item.blocked}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-2 px-5 py-5 md:px-6">
          <h3 className="text-[15px] font-semibold">Past bookings</h3>
          {past.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing booked yet.</p>
          )}
          <ul className="divide-y">
            {past.data?.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center gap-2 py-2 text-[14px]">
                <span className="flex-1">
                  Up to {formatDate(booking.up_to)} · {booking.items} lines
                </span>
                {BOOKING_FORMATS.map((format) => (
                  <a
                    key={format.value}
                    href={bookingExportUrl(booking.id, format.value)}
                    aria-label={`Download booking up to ${formatDate(booking.up_to)} as ${format.label}`}
                    className="text-[13px] text-link underline underline-offset-4 hover:no-underline"
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
