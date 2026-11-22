'use client'

import { Button } from '@helvetly/ui/components/button'
import { DataTable, listTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatMoney } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Plus,
  ReceiptText,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import { useImportDrawer } from '@/components/import/import-button'
import { ImportDrawer } from '@/components/import/import-drawer'
import { PageIntro } from '@/components/settings/layout'
import { PageHeader } from '@/components/shell/page-header'
import { formatPay } from '@/lib/employees'
import { translate } from '@/lib/i18n'
import { parseSort, sortParam, sortRows, type Sort } from '@/lib/list-sort'
import {
  DEFAULT_SORT,
  exportUrl,
  IMPORT_COLUMNS,
  missingNotes,
  monthLabel,
  monthOr,
  shiftMonth,
  SORT_FIELDS,
  sortValue,
  usePayrollEntries,
  usePayrollSummary,
  type PayrollEntry,
  type PayrollTotals,
  type SortField,
} from '@/lib/payroll'
import { setUrlQuery } from '@/lib/url-query'

import { HrLockNotice, HrUpsell, useHrAccess, useHrTabs } from './hr-access'
import { BookingsSheet } from './payroll-bookings'
import { EntrySheet, EntryStatus, NewEntrySheet } from './payroll-entry'

const AMOUNTS = [
  ['gross', translate('payrollGross')],
  ['deductions', translate('payrollDeductions')],
  ['net', translate('payrollNet')],
  ['employer_costs', translate('payrollEmployerCosts')],
] as const

export function PayrollPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const month = monthOr(query.get('month'))
  const entryId = query.get('entry')
  const sort = parseSort(query.get('sort'), SORT_FIELDS, DEFAULT_SORT)
  const [superseded, setSuperseded] = useState(false)
  const [bookingsOpen, setBookingsOpen] = useState(false)
  const hr = useHrAccess()
  const tabs = useHrTabs('payroll')
  const entries = usePayrollEntries(month, superseded, !hr.blocked)
  const summary = usePayrollSummary(month, !hr.blocked)
  const importDrawer = useImportDrawer()
  const empty = entries.data?.length === 0

  const go = (change: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(change))
      if (value === null) next.delete(key)
      else next.set(key, value)
    setUrlQuery(pathname, next, push)
  }
  const open = (id: string) => go({ entry: id, new: null }, true)
  const create = () => go({ new: '1', entry: null }, true)

  return (
    <>
      <PageHeader
        {...tabs}
        primary={hr.writePayroll && !empty ? translate('payrollNewEntry') : undefined}
        onPrimary={create}
        actions={
          !hr.blocked && (
            <>
              {hr.writePayroll && (
                <span className="flex items-center gap-0.5">
                  <Button variant="ghost" size="sm" onClick={importDrawer.open}>
                    <FileUp /> <span className="max-sm:sr-only">{translate('payrollImport')}</span>
                  </Button>
                  <HelpTip label={translate('payrollImportColumnsLabel')}>
                    {translate('payrollImportColumnsTip', { columns: IMPORT_COLUMNS.join(', ') })}
                  </HelpTip>
                </span>
              )}
              <Button asChild variant="ghost" size="sm">
                <a href={exportUrl(month)}>
                  <Download />{' '}
                  <span className="max-sm:sr-only">{translate('payrollExportCsv')}</span>
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBookingsOpen(true)}>
                <BookOpenCheck />{' '}
                <span className="max-sm:sr-only">{translate('payrollBookings')}</span>
              </Button>
            </>
          )
        }
      />
      <PageIntro
        title={translate('payrollTab')}
        description={translate('payrollPageDescription')}
        className="px-3 pt-4 md:px-5"
      />
      <HrLockNotice hr={hr} />
      {hr.blocked ? (
        <HrUpsell hr={hr} />
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 md:px-5">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('payrollPreviousMonth')}
                    onClick={() => go({ month: shiftMonth(month, -1) })}
                  >
                    <ChevronLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('payrollPreviousMonth')}</TooltipContent>
              </Tooltip>
              <h2 aria-live="polite" className="min-w-36 text-center text-title-sm font-medium">
                {monthLabel(month)}
              </h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('payrollNextMonth')}
                    onClick={() => go({ month: shiftMonth(month, 1) })}
                  >
                    <ChevronRight />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('payrollNextMonth')}</TooltipContent>
              </Tooltip>
            </div>
            <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <Switch id="show-corrected" checked={superseded} onCheckedChange={setSuperseded} />
              <label htmlFor="show-corrected">{translate('payrollShowCorrected')}</label>
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-caption text-muted-foreground">
              {translate('payrollRecordedNotCalculated')}
              <HelpTip label={translate('payrollRegisterLabel')}>
                {translate('payrollRegisterTip')}
              </HelpTip>
            </span>
          </div>

          <Summary totals={summary.data} />

          {entries.error ? (
            <LoadProblem
              error={entries.error}
              what={translate('payrollTheRegister')}
              onRetry={() => void entries.refetch()}
            />
          ) : !entries.data ? (
            <LoadingRows />
          ) : entries.data.length === 0 ? (
            <State
              icon={<ReceiptText />}
              title={translate('payrollEmptyTitle', { month: monthLabel(month) })}
              text={translate('payrollEmptyText')}
              action={
                hr.writePayroll && (
                  <Button size="sm" className="gap-1.5" onClick={create}>
                    <Plus className="size-3.5" /> {translate('payrollNewEntry')}
                  </Button>
                )
              }
            />
          ) : (
            <EntryList
              entries={entries.data}
              sort={sort}
              onSort={(field, desc) => go({ sort: sortParam({ field, desc }, DEFAULT_SORT) })}
              onOpen={open}
            />
          )}
        </div>
      )}
      {entryId && !hr.blocked && (
        <EntrySheet id={entryId} onClose={() => go({ entry: null })} onOpen={open} />
      )}
      {query.get('new') === '1' && hr.writePayroll && (
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

// A sum is shown only when every entry has the value: a sum over some entries would read as the month's total.
// The missing counts below say what is incomplete.
function summaryValue(total: PayrollTotals, key: (typeof AMOUNTS)[number][0] | 'total_cost') {
  const missing = {
    gross: total.missing_gross,
    deductions: total.missing_deductions,
    net: total.missing_net,
    employer_costs: total.missing_employer_costs,
    total_cost: total.missing_gross + total.missing_employer_costs,
  }[key]
  return missing > 0 ? '—' : formatMoney(total[key], total.currency)
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
            aria-label={translate('payrollTotalsIn', { currency: total.currency })}
            className="grid content-start gap-2 rounded-xl bg-card px-4 py-3 shadow-elevation-1"
          >
            <h3 className="flex items-center justify-between text-body-sm font-medium text-muted-foreground">
              {total.currency}
              <span className="text-caption font-normal">
                {translate('payrollTotalsCount', { entries: total.entries, drafts: total.drafts })}
              </span>
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm">
              {[...AMOUNTS, ['total_cost', translate('payrollTotalCost')] as const].map(
                ([key, label]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right tabular-nums">{summaryValue(total, key)}</dd>
                  </div>
                ),
              )}
            </dl>
            {notes.length > 0 && (
              <ul className="grid gap-0.5 text-caption text-warning">
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

function EntryList({
  entries: unsorted,
  sort,
  onSort,
  onOpen,
}: {
  entries: PayrollEntry[]
  sort: Sort<SortField>
  onSort: (field: SortField, desc: boolean) => void
  onOpen: (id: string) => void
}) {
  const entries = sortRows(unsorted, (entry) => sortValue(entry, sort.field), sort.desc)
  return (
    <>
      <DataTable
        id="payroll"
        className="hidden lg:table"
        columns={entryColumns(onOpen)}
        data={entries}
        getRowId={(entry) => entry.id}
        sorting={{
          column: sort.field,
          desc: sort.desc,
          onSort: (column, desc) => {
            const field = SORT_FIELDS.find((entry) => entry === column)
            if (field) onSort(field, desc)
          },
        }}
        rowProps={(entry) => ({
          'data-superseded': entry.superseded_by ? true : undefined,
          className: 'data-superseded:text-muted-foreground',
        })}
      />
      <ul className={cn(listTable.list, 'lg:hidden')}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="grid min-w-0 flex-1 leading-snug">
                <span className="truncate text-title-sm">{entry.employee_name}</span>
                <span className="text-body-sm text-muted-foreground tabular-nums">
                  {translate('payrollGrossNet', {
                    gross: formatPay(entry.gross, entry.currency),
                    net: formatPay(entry.net, entry.currency),
                  })}
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

function entryColumns(onOpen: (id: string) => void): DataColumn<PayrollEntry>[] {
  return [
    {
      id: 'employee',
      header: translate('payrollColEmployee'),
      flex: true,
      sortable: true,
      cell: (entry) => (
        <button
          type="button"
          onClick={() => onOpen(entry.id)}
          className="cursor-pointer truncate text-left hover:underline"
        >
          {entry.employee_name}
        </button>
      ),
    },
    {
      id: 'period',
      header: translate('payrollColPeriod'),
      size: 124,
      minSize: 100,
      sortable: true,
      sortDescFirst: true,
      className: 'tabular-nums',
      cell: (entry) => `${entry.period_start.slice(5)} – ${entry.period_end.slice(5)}`,
    },
    ...AMOUNTS.map(([key, label]): DataColumn<PayrollEntry> => ({
      id: key,
      header: label,
      size: 128,
      resizable: false,
      sortable: true,
      sortDescFirst: true,
      align: 'right',
      cell: (entry) => formatPay(entry[key], entry.currency),
    })),
    {
      id: 'status',
      header: translate('employeeStatusLabel'),
      size: 132,
      resizable: false,
      cell: (entry) => <EntryStatus entry={entry} />,
    },
  ]
}
