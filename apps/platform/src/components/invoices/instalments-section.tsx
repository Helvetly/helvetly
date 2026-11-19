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
import { Switch } from '@helvetly/ui/components/switch'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarRange, Pencil, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
import { inputClass, NativeSelect } from '@/components/clients/fields'
import { translate } from '@/lib/i18n'
import { formatMoney, INTERVALS, type Interval, type InvoiceSettings } from '@/lib/invoices'

import { DateField } from './date-fields'
import {
  instalmentsSummary,
  startInstalments,
  type EditorErrors,
  type EditorInstalments,
  type InstalmentRow,
} from './editor-model'

/**
 * The editor footer's "Pay in instalments": one invoice, several due dates, one QR bill each. A compact row with the
 * schedule's summary; the settings, payment reminders included (they follow the instalments' due dates), open in a dialog.
 */
export function InstalmentsSection({
  value,
  onChange,
  reminders,
  onReminders,
  payable,
  generated,
  currency,
  issueDate,
  firstDue,
  settings,
  errors,
  blocker,
  onSplit,
}: {
  value: EditorInstalments | null
  onChange: (next: EditorInstalments | null) => void
  reminders: boolean
  onReminders: (on: boolean) => void
  /** From the server's preview; null while it loads. */
  payable: string | null
  /** The rows the server's preview generates for the schedule. */
  generated: InstalmentRow[]
  currency: string
  issueDate: string
  /** Where a new schedule's first instalment falls: the invoice's due date. */
  firstDue: string
  settings: InvoiceSettings
  errors: EditorErrors
  /** Why it cannot be issued (scheduleBlocker), shown under the rows. */
  blocker: string | null
  /** Opens the plan dialog ("Split into instalment invoices"); absent until the draft is saved. */
  onSplit?: () => void
}) {
  const rows = value ? (value.items ?? generated) : []
  // Count, interval or first date start the rows over from equal parts.
  const reshape = (change: Partial<EditorInstalments>) =>
    value && onChange({ ...value, ...change, items: null })
  const editRow = (index: number, change: Partial<InstalmentRow>) =>
    value &&
    onChange({
      ...value,
      items: rows.map((row, i) => (i === index ? { ...row, ...change } : row)),
    })
  const prefersPlan = settings.instalments.mode === 'plan'
  // a plan without automations keeps a schedule there is, to switch off, but starts none
  const lock = useFeatureLock('automations')
  const startLocked = Boolean(lock) && value === null
  // Edits apply live, so the server's preview keeps the rows current; Cancel puts back what was there on opening.
  const [opened, setOpened] = useState<{ before: EditorInstalments | null; reminders: boolean }>()
  const cancel = () => {
    if (!opened) return
    onChange(opened.before)
    onReminders(opened.reminders)
    setOpened(undefined)
  }
  const invalid =
    Boolean(blocker) || Object.keys(errors).some((name) => name.startsWith('instalments'))
  const unsaveable = invalid || !value?.first_due_date || !value.count

  return (
    <section
      aria-labelledby="pay-in-instalments"
      className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-1"
    >
      <label
        id="pay-in-instalments"
        htmlFor="invoice-instalments"
        className="flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground"
      >
        <CalendarRange className="size-3.5" />
        {translate('payInInstalments')}
        {lock && <PlanTag lock={lock} className="ml-1" />}
      </label>
      {value && (
        <span
          className={cn(
            'min-w-0 truncate text-body-sm tabular-nums',
            invalid ? 'text-destructive' : 'text-foreground',
          )}
        >
          {instalmentsSummary(value)}
          {blocker && ` · ${blocker}`}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {value && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={translate('editInstalments')}
                className="text-muted-foreground"
                onClick={() => setOpened({ before: value, reminders })}
              >
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('editInstalments')}</TooltipContent>
          </Tooltip>
        )}
        {onSplit && !value && (
          <Button
            type="button"
            variant={prefersPlan ? 'outline' : 'ghost'}
            size="sm"
            disabled={Boolean(lock)}
            onClick={onSplit}
          >
            {translate('splitIntoInstalmentInvoices')}
          </Button>
        )}
        <Switch
          id="invoice-instalments"
          disabled={startLocked}
          checked={value !== null}
          onCheckedChange={(on) => {
            if (!on) return onChange(null)
            setOpened({ before: null, reminders })
            onChange(startInstalments(settings, firstDue))
          }}
        />
      </div>

      {value && opened && (
        <Dialog open onOpenChange={(open) => !open && cancel()}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{translate('payInInstalments').trim()}</DialogTitle>
              <DialogDescription>{translate('instalmentsDialogDescription')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                  {translate('instalments2')}
                  <input
                    aria-label={translate('numberOfInstalments')}
                    aria-invalid={errors['instalments.count'] ? true : undefined}
                    inputMode="numeric"
                    value={value.count}
                    onChange={(event) =>
                      reshape({ count: event.target.value.replace(/\D/g, '').slice(0, 2) })
                    }
                    className={cn(inputClass, 'h-8 w-16 text-right tabular-nums')}
                  />
                </label>
                <label className="grid gap-1 text-[12.5px] text-muted-foreground">
                  {translate('every')}
                  <NativeSelect
                    aria-label={translate('interval')}
                    value={value.interval}
                    onChange={(event) => {
                      const picked = INTERVALS.find((entry) => entry.value === event.target.value)
                      if (picked) reshape({ interval: picked.value satisfies Interval })
                    }}
                    className="h-8 w-44 text-[13px]"
                  >
                    {INTERVALS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <div className="grid gap-1 text-[12.5px] text-muted-foreground">
                  <span>{translate('firstDue')}</span>
                  <DateField
                    id="invoice-instalments-first"
                    label={translate('firstDueDate')}
                    value={value.first_due_date}
                    min={issueDate}
                    invalid={Boolean(errors['instalments.first_due_date'])}
                    onChange={(date) => reshape({ first_due_date: date })}
                  />
                </div>
              </div>
              {errors['instalments.count'] && (
                <p className="text-[12px] text-destructive">
                  {errors['instalments.count']}
                  {translate('instalments3')}
                </p>
              )}

              <ol className="grid gap-1">
                {rows.map((row, i) => {
                  const amountError = errors[`instalments.items.${i}.amount`]
                  return (
                    <li key={i} className="flex items-center gap-3 text-[14px]">
                      <span className="w-24 text-[13px] text-muted-foreground tabular-nums">
                        {i + 1}
                        {translate('of5')}
                        {rows.length}
                      </span>
                      <DateField
                        id={`invoice-instalment-${i + 1}-due`}
                        label={translate('instalmentDueDate', { value1: i + 1 })}
                        value={row.due_date}
                        min={issueDate}
                        invalid={Boolean(errors[`instalments.items.${i}.due_date`])}
                        onChange={(date) => editRow(i, { due_date: date })}
                      />
                      <input
                        aria-label={translate('instalmentAmount', { value1: i + 1 })}
                        aria-invalid={amountError ? true : undefined}
                        title={amountError}
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(event) => editRow(i, { amount: event.target.value })}
                        className={cn(inputClass, 'ml-auto h-8 w-32 text-right tabular-nums')}
                      />
                    </li>
                  )
                })}
              </ol>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[13px]">
                <span className="text-muted-foreground tabular-nums">
                  {translate('amountDue')}
                  {payable === null ? '—' : formatMoney(payable, currency)}
                </span>
                {blocker && <output className="text-destructive tabular-nums">{blocker}</output>}
                {value.items && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => onChange({ ...value, items: null })}
                  >
                    <RotateCcw className="size-3.5" />
                    {translate('equalParts')}
                  </Button>
                )}
              </div>

              <SwitchRow
                id="invoice-instalment-reminders"
                label={translate('paymentReminders')}
                description={translate('emailsTheClientBeforeAndAfterEachDueDate')}
                checked={reminders}
                onCheckedChange={onReminders}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cancel}>
                {translate('cancel')}
              </Button>
              <Button type="button" disabled={unsaveable} onClick={() => setOpened(undefined)}>
                {translate('save').trim()}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
