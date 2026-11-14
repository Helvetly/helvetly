'use client'

import { Button } from '@helvetly/ui/components/button'
import { Switch } from '@helvetly/ui/components/switch'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { cn } from '@helvetly/ui/lib/utils'
import { CalendarRange, RotateCcw } from 'lucide-react'

import { inputClass, NativeSelect } from '@/components/clients/fields'
import { formatMoney, INTERVALS, type Interval, type InvoiceSettings } from '@/lib/invoices'

import { DateField } from './date-fields'
import {
  startInstalments,
  type EditorErrors,
  type EditorInstalments,
  type InstalmentRow,
} from './editor-model'

/** The editor's "Pay in instalments": one invoice, several due dates, one QR bill each. */
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

  return (
    <section aria-labelledby="pay-in-instalments" className="grid gap-3 rounded-xl px-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          id="pay-in-instalments"
          htmlFor="invoice-instalments"
          className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"
        >
          <CalendarRange className="size-3.5" /> Pay in instalments
        </label>
        <div className="flex items-center gap-3">
          {onSplit && (
            <Button
              type="button"
              variant={prefersPlan ? 'outline' : 'ghost'}
              size="sm"
              disabled={value !== null}
              title={value ? 'Turn the schedule off to split into invoices instead.' : undefined}
              onClick={onSplit}
            >
              Split into instalment invoices
            </Button>
          )}
          <Switch
            id="invoice-instalments"
            checked={value !== null}
            onCheckedChange={(on) => onChange(on ? startInstalments(settings, firstDue) : null)}
          />
        </div>
      </div>

      {value && (
        <div className="grid gap-3 rounded-xl bg-card px-4 py-4 shadow-elevation-1">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-[12.5px] text-muted-foreground">
              Instalments
              <input
                aria-label="Number of instalments"
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
              Every
              <NativeSelect
                aria-label="Interval"
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
              <span>First due</span>
              <DateField
                id="invoice-instalments-first"
                label="First due date"
                value={value.first_due_date}
                min={issueDate}
                invalid={Boolean(errors['instalments.first_due_date'])}
                onChange={(date) => reshape({ first_due_date: date })}
              />
            </div>
          </div>
          {errors['instalments.count'] && (
            <p className="text-[12px] text-destructive">
              {errors['instalments.count']} instalments.
            </p>
          )}

          <ol className="grid gap-1">
            {rows.map((row, i) => {
              const amountError = errors[`instalments.items.${i}.amount`]
              return (
                <li key={i} className="flex items-center gap-3 text-[14px]">
                  <span className="w-24 text-[13px] text-muted-foreground tabular-nums">
                    {i + 1} of {rows.length}
                  </span>
                  <DateField
                    id={`invoice-instalment-${i + 1}-due`}
                    label={`Instalment ${i + 1} due date`}
                    value={row.due_date}
                    min={issueDate}
                    invalid={Boolean(errors[`instalments.items.${i}.due_date`])}
                    onChange={(date) => editRow(i, { due_date: date })}
                  />
                  <input
                    aria-label={`Instalment ${i + 1} amount`}
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
              Amount due {payable === null ? '—' : formatMoney(payable, currency)}
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
                <RotateCcw className="size-3.5" /> Equal parts
              </Button>
            )}
          </div>

          <SwitchRow
            id="invoice-instalment-reminders"
            label="Payment reminders"
            description="Emails the client before and after each due date while it is open."
            checked={reminders}
            onCheckedChange={onReminders}
          />
        </div>
      )}
    </section>
  )
}
