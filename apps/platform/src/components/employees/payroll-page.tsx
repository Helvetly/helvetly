'use client'

import { Button } from '@helvetly/ui/components/button'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatMoney } from '@helvetly/ui/lib/format'
import {
  Banknote,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  ReceiptText,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import { useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { PageHeader } from '@/components/shell/page-header'
import { formatPay } from '@/lib/employees'
import {
  exportUrl,
  IMPORT_COLUMNS,
  missingNotes,
  monthLabel,
  monthOr,
  shiftMonth,
  usePayrollEntries,
  usePayrollSummary,
  type PayrollEntry,
  type PayrollTotals,
} from '@/lib/payroll'
import { useCan } from '@/lib/permissions'
import { setUrlQuery } from '@/lib/url-query'

import { BookingsSheet } from './payroll-bookings'
import { EntrySheet, EntryStatus, NewEntrySheet } from './payroll-entry'

const AMOUNTS = [
  ['gross', 'Gross'],
  ['deductions', 'Deductions'],
  ['net', 'Net'],
  ['employer_costs', 'Employer costs'],
] as const

export function PayrollPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const month = monthOr(query.get('month'))
  const entryId = query.get('entry')
  const [superseded, setSuperseded] = useState(false)
  const [bookingsOpen, setBookingsOpen] = useState(false)
  const entries = usePayrollEntries(month, superseded)
  const summary = usePayrollSummary(month)
  const canWrite = useCan('write:payroll')
  const canExport = useCan('read:payroll-export')
  const importDrawer = useImportDrawer()

  const go = (change: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(change))
      if (value === null) next.delete(key)
      else next.set(key, value)
    setUrlQuery(pathname, next, push)
  }
  const open = (id: string) => go({ entry: id, new: null }, true)

  return (
    <>
      <PageHeader
        tabs={['Payroll']}
        tabIcons={[Banknote]}
        savedViews={false}
        primary="New entry"
        onPrimary={() => go({ new: '1', entry: null }, true)}
        actions={
          <>
            {canWrite && (
              <span className="flex items-center gap-0.5">
                <Button variant="ghost" size="sm" onClick={importDrawer.open}>
                  <FileUp /> <span className="max-sm:sr-only">Import</span>
                </Button>
                <HelpTip label="Payroll CSV columns">
                  A CSV with a header row: {IMPORT_COLUMNS.join(', ')}. An empty cell is a missing
                  figure, never 0; imported entries start as drafts.
                </HelpTip>
              </span>
            )}
            {canExport && (
              <>
                <Button asChild variant="ghost" size="sm">
                  <a href={exportUrl(month)}>
                    <Download /> <span className="max-sm:sr-only">Export CSV</span>
                  </a>
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBookingsOpen(true)}>
                  <BookOpenCheck /> <span className="max-sm:sr-only">Bookings</span>
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 md:px-5">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous month"
                  onClick={() => go({ month: shiftMonth(month, -1) })}
                >
                  <ChevronLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous month</TooltipContent>
            </Tooltip>
            <h2 aria-live="polite" className="min-w-36 text-center text-[15px] font-medium">
              {monthLabel(month)}
            </h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next month"
                  onClick={() => go({ month: shiftMonth(month, 1) })}
                >
                  <ChevronRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next month</TooltipContent>
            </Tooltip>
          </div>
          <span className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
            <Switch id="show-corrected" checked={superseded} onCheckedChange={setSuperseded} />
            <label htmlFor="show-corrected">Show corrected entries</label>
          </span>
          <p className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            Recording an entry does not certify it. Approved is not paid.
            <HelpTip label="About the payroll register">
              Helvetly records pay that you or your payroll provider computed; it does not calculate
              pay, taxes or contributions. Approving confirms an entry, marking it paid records the
              payment. A correction replaces an approved entry and keeps the original.
            </HelpTip>
          </p>
        </div>

        <Summary totals={summary.data} />

        {entries.error ? (
          <LoadProblem
            error={entries.error}
            what="The payroll register"
            onRetry={() => void entries.refetch()}
          />
        ) : !entries.data ? (
          <LoadingRows />
        ) : entries.data.length === 0 ? (
          <State
            icon={<ReceiptText />}
            title={`No payroll entries for ${monthLabel(month)}`}
            text="Record each employee’s pay for the month, or import it from your payroll provider."
            action={
              canWrite && (
                <Button variant="outline" size="sm" onClick={importDrawer.open}>
                  <FileUp /> Import payroll
                </Button>
              )
            }
          />
        ) : (
          <EntryList entries={entries.data} onOpen={open} />
        )}
      </div>
      {entryId && <EntrySheet id={entryId} onClose={() => go({ entry: null })} onOpen={open} />}
      {query.get('new') === '1' && (
        <NewEntrySheet
          month={month}
          onClose={() => go({ new: null })}
          onCreated={(created) => open(created.id)}
        />
      )}
      {bookingsOpen && <BookingsSheet month={month} onClose={() => setBookingsOpen(false)} />}
      {importDrawer.isOpen && <ImportDrawer kind="payroll" onClose={importDrawer.close} />}
    </>
  )
}

function Summary({ totals }: { totals: PayrollTotals[] | undefined }) {
  if (!totals || totals.length === 0) return null
  return (
    <div className="grid gap-3 border-b p-3 sm:grid-cols-2 md:p-5 xl:grid-cols-3">
      {totals.map((total) => {
        const notes = missingNotes(total)
        return (
          <section
            key={total.currency}
            aria-label={`Totals in ${total.currency}`}
            className="grid content-start gap-2 rounded-xl bg-card px-4 py-3 shadow-elevation-1"
          >
            <h3 className="flex items-center justify-between text-body-sm font-medium text-muted-foreground">
              {total.currency}
              <span className="text-[12px] font-normal">
                {total.entries} {total.entries === 1 ? 'entry' : 'entries'} · {total.drafts} draft
              </span>
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px]">
              {[...AMOUNTS, ['total_cost', 'Total cost'] as const].map(([key, label]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right tabular-nums">
                    {formatMoney(total[key], total.currency)}
                  </dd>
                </div>
              ))}
            </dl>
            {notes.length > 0 && (
              <ul className="grid gap-0.5 text-[12.5px] text-warning">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function EntryList({ entries, onOpen }: { entries: PayrollEntry[]; onOpen: (id: string) => void }) {
  return (
    <>
      <table className="hidden w-full table-fixed text-[15px] lg:table">
        <thead>
          <tr className="h-11 border-b bg-muted/50 text-left text-[13px] text-muted-foreground">
            <th className="w-[24%] pl-5 font-medium">Employee</th>
            <th className="w-[14%] px-3 font-medium">Period</th>
            {AMOUNTS.map(([key, label]) => (
              <th key={key} className="px-3 text-right font-medium">
                {label}
              </th>
            ))}
            <th className="w-[18%] px-3 pr-5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              data-superseded={entry.superseded_by ? true : undefined}
              className="h-[52px] border-b border-border/60 hover:bg-card/70 data-superseded:text-muted-foreground"
            >
              <td className="truncate pl-5">
                <button
                  type="button"
                  onClick={() => onOpen(entry.id)}
                  className="cursor-pointer truncate text-left hover:underline"
                >
                  {entry.employee_name}
                </button>
              </td>
              <td className="truncate px-3 text-[13.5px] tabular-nums">
                {entry.period_start.slice(5)} – {entry.period_end.slice(5)}
              </td>
              {AMOUNTS.map(([key]) => (
                <td key={key} className="truncate px-3 text-right tabular-nums">
                  {formatPay(entry[key], entry.currency)}
                </td>
              ))}
              <td className="px-3 pr-5">
                <EntryStatus entry={entry} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border/70 lg:hidden">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="grid min-w-0 flex-1 leading-snug">
                <span className="truncate text-[15px]">{entry.employee_name}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  Gross {formatPay(entry.gross, entry.currency)} · Net{' '}
                  {formatPay(entry.net, entry.currency)}
                </span>
              </span>
              <EntryStatus entry={entry} />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
