'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField, HelpTip } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, CircleCheck, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Combobox, CURRENCY_OPTIONS, inputClass, NativeSelect } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { ApiError, errorMessage } from '@/lib/api'
import { formatPay, fullName, useEmployeeList } from '@/lib/employees'
import {
  COMPONENT_KINDS,
  monthPeriod,
  useApproveEntry,
  useCorrectEntry,
  useDeleteEntry,
  usePayment,
  usePayrollEntry,
  useSaveEntry,
  type ComponentKind,
  type EntryInput,
  type PayrollEntry,
} from '@/lib/payroll'
import { useCan } from '@/lib/permissions'

const SHEET = 'w-full! max-w-none! gap-0 p-0 sm:w-[min(720px,100vw)]! dark:bg-card'
const STALE = 'This entry was changed meanwhile. Reload it and try again.'

export function EntryStatus({ entry }: { entry: PayrollEntry }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entry.status === 'approved' ? (
        <StatusBadge tone="green">Approved</StatusBadge>
      ) : (
        <StatusBadge>Draft</StatusBadge>
      )}
      {entry.status === 'approved' &&
        (entry.payment_status === 'paid' ? (
          <StatusBadge tone="blue">Paid</StatusBadge>
        ) : (
          <StatusBadge tone="amber">Unpaid</StatusBadge>
        ))}
      {entry.superseded_by && <StatusBadge tone="gray">Corrected</StatusBadge>}
    </span>
  )
}

/** One payroll entry in a drawer: its figures, what may be done with it, and the form for a draft. */
export function EntrySheet({
  id,
  onClose,
  onOpen,
}: {
  id: string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const query = usePayrollEntry(id)
  const entry = query.data
  const [editing, setEditing] = useState(false)
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" showCloseButton={false} className={SHEET}>
        <SheetTitle className="sr-only">
          {entry ? `Payroll entry for ${entry.employee_name}` : 'Payroll entry'}
        </SheetTitle>
        <SheetDescription className="sr-only">Payroll register entry</SheetDescription>
        {entry && editing ? (
          <EntryForm entry={entry} onDone={() => setEditing(false)} />
        ) : entry ? (
          <EntryView
            entry={entry}
            onClose={onClose}
            onEdit={() => setEditing(true)}
            onOpen={onOpen}
            onReload={() => void query.refetch()}
          />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-[15px]">This entry couldn’t be loaded.</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, 'This entry')}
            </p>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[15px] font-medium tabular-nums">{value}</span>
    </div>
  )
}

const today = () => new Date().toISOString().slice(0, 10)

function EntryView({
  entry,
  onClose,
  onEdit,
  onOpen,
  onReload,
}: {
  entry: PayrollEntry
  onClose: () => void
  onEdit: () => void
  onOpen: (id: string) => void
  onReload: () => void
}) {
  const canWrite = useCan('write:payroll')
  const canApprove = useCan('write:payroll-approval')
  const approve = useApproveEntry()
  const payment = usePayment()
  const correct = useCorrectEntry()
  const remove = useDeleteEntry()
  const [stale, setStale] = useState(false)
  const [paidOn, setPaidOn] = useState(entry.pay_date ?? today())
  const [deleting, setDeleting] = useState(false)
  const current = !entry.superseded_by
  const draft = entry.status === 'draft'

  const failed = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409 && error.code === 'conflict')
      setStale(true)
    else toast.error(errorMessage(error))
  }
  const reload = () => {
    setStale(false)
    onReload()
  }
  const pay = (date: string | null) =>
    payment.mutate(
      { entry, paidOn: date },
      {
        onSuccess: () => toast.success(date ? 'Marked as paid.' : 'Marked as unpaid.'),
        onError: failed,
      },
    )
  const money = (value: string | null) => formatPay(value, entry.currency)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-start gap-3 border-b px-5 py-4 md:px-6">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="truncate text-lg font-semibold">{entry.employee_name}</h2>
          <p className="text-[13px] text-muted-foreground">
            {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
            {entry.pay_date && ` · paid out ${formatDate(entry.pay_date)}`}
          </p>
          <EntryStatus entry={entry} />
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

      <div className="grid content-start gap-4 p-5 md:p-6">
        {stale && (
          <Callout
            role="alert"
            tone="warning"
            actions={
              <Button size="sm" variant="outline" onClick={reload}>
                <RotateCcw /> Reload
              </Button>
            }
          >
            {STALE}
          </Callout>
        )}
        {entry.superseded_by && (
          <Callout tone="neutral">
            A correction replaced this entry. It stays in the register as it was approved.
          </Callout>
        )}
        {entry.supersedes_id && draft && (
          <Callout tone="info">
            This draft corrects an approved entry, which is kept until this one is approved.
          </Callout>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Figure label="Gross" value={money(entry.gross)} />
          <Figure label="Deductions" value={money(entry.deductions)} />
          <Figure label="Net pay" value={money(entry.net)} />
          <Figure label="Employer costs" value={money(entry.employer_costs)} />
          <Figure label="Total cost" value={money(entry.total_cost)} />
        </div>
        {!entry.complete && (
          <p className="text-[13px] text-muted-foreground">
            Some figures are not known yet; a dash means missing, never zero.
          </p>
        )}

        {entry.components.length > 0 && (
          <ul aria-label="Components" className="divide-y rounded-lg ring-1 ring-border">
            {entry.components.map((component) => (
              <li
                key={`${component.kind}:${component.label}:${component.amount}`}
                className="flex items-center gap-3 px-3 py-2 text-[14px]"
              >
                <span className="flex-1 truncate">{component.label}</span>
                <span className="text-[12px] text-muted-foreground">
                  {COMPONENT_KINDS.find((kind) => kind.value === component.kind)?.label}
                </span>
                <span className="tabular-nums">{money(component.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px]">
          <dt className="text-muted-foreground">Source</dt>
          <dd>
            {entry.source}
            {entry.source_ref && ` · ${entry.source_ref}`}
          </dd>
          {entry.approved_by && (
            <>
              <dt className="text-muted-foreground">Approved by</dt>
              <dd>{entry.approved_by}</dd>
            </>
          )}
          {entry.paid_on && (
            <>
              <dt className="text-muted-foreground">Paid on</dt>
              <dd>{formatDate(entry.paid_on)}</dd>
            </>
          )}
          {entry.note && (
            <>
              <dt className="text-muted-foreground">Note</dt>
              <dd className="whitespace-pre-wrap">{entry.note}</dd>
            </>
          )}
        </dl>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span>Recording an entry does not certify it.</span>
          <span>Approved is not paid.</span>
          <HelpTip label="About approval and payment">
            Approving confirms the figures someone computed; marking it paid records that the net
            pay left your account. Helvetly moves no money.
          </HelpTip>
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {draft && canWrite && (
            <Button variant="outline" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
          )}
          {draft && canApprove && (
            <Button
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate(entry, {
                  onSuccess: () => toast.success('Entry approved.'),
                  onError: failed,
                })
              }
            >
              <CircleCheck /> Approve
            </Button>
          )}
          {!draft && current && canApprove && entry.payment_status === 'unpaid' && (
            <span className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Payment date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
                className={cn(inputClass, 'w-40')}
              />
              <Button disabled={payment.isPending || !paidOn} onClick={() => pay(paidOn)}>
                <Check /> Mark as paid
              </Button>
            </span>
          )}
          {!draft && current && canApprove && entry.payment_status === 'paid' && (
            <Button variant="outline" disabled={payment.isPending} onClick={() => pay(null)}>
              Mark as unpaid
            </Button>
          )}
          {!draft && current && canWrite && (
            <Button
              variant="outline"
              disabled={correct.isPending}
              onClick={() =>
                correct.mutate(entry.id, {
                  onSuccess: (created) => {
                    toast.success('Correction started as a draft.')
                    onOpen(created.id)
                  },
                  onError: failed,
                })
              }
            >
              <RotateCcw /> Correct
            </Button>
          )}
          {draft && canWrite && (
            <Button
              variant="destructive-ghost"
              className="ml-auto"
              onClick={() => setDeleting(true)}
            >
              <Trash2 /> Delete draft
            </Button>
          )}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete this draft?"
          body="The draft entry is removed from the register. Approved entries are never deleted."
          confirmLabel="Delete draft"
          tone="destructive"
          onDecide={(approved) => {
            setDeleting(false)
            if (approved)
              remove.mutate(entry.id, {
                onSuccess: () => {
                  toast.success('Draft deleted.')
                  onClose()
                },
                onError: failed,
              })
          }}
        />
      )}
    </div>
  )
}

/** A component line in the editor; `key` stays in the form and is never sent. */
type Line = { key: string; kind: ComponentKind; label: string; amount: string }
const newKey = () => crypto.randomUUID()
type Values = {
  employee_id: string
  period_start: string
  period_end: string
  pay_date: string
  currency: string
  gross: string
  deductions: string
  net: string
  employer_costs: string
  components: Line[]
  source_ref: string
  note: string
}

const valuesOf = (entry: PayrollEntry): Values => ({
  employee_id: entry.employee_id,
  period_start: entry.period_start,
  period_end: entry.period_end,
  pay_date: entry.pay_date ?? '',
  currency: entry.currency,
  gross: entry.gross ?? '',
  deductions: entry.deductions ?? '',
  net: entry.net ?? '',
  employer_costs: entry.employer_costs ?? '',
  components: entry.components.map((component) => ({ ...component, key: newKey() })),
  source_ref: entry.source_ref ?? '',
  note: entry.note ?? '',
})

const blankValues = (month: string): Values => {
  const { start, end } = monthPeriod(month)
  return {
    employee_id: '',
    period_start: start,
    period_end: end,
    pay_date: '',
    currency: 'CHF',
    gross: '',
    deductions: '',
    net: '',
    employer_costs: '',
    components: [],
    source_ref: '',
    note: '',
  }
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim())
const id = (key: string) => `payroll-${key}`

/** The API's body: an empty amount is missing (null), never 0. */
export function entryInput(values: Values): EntryInput {
  return {
    employee_id: values.employee_id,
    period_start: values.period_start,
    period_end: values.period_end,
    pay_date: orNull(values.pay_date),
    currency: values.currency,
    gross: orNull(values.gross),
    deductions: orNull(values.deductions),
    net: orNull(values.net),
    employer_costs: orNull(values.employer_costs),
    components: values.components.map(({ kind, label, amount }) => ({ kind, label, amount })),
    source_ref: orNull(values.source_ref),
    note: orNull(values.note),
  }
}

/** A new draft entry in its own drawer. */
export function NewEntrySheet({
  month,
  onClose,
  onCreated,
}: {
  month: string
  onClose: () => void
  onCreated: (entry: PayrollEntry) => void
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" showCloseButton={false} className={SHEET}>
        <SheetTitle className="sr-only">New entry</SheetTitle>
        <SheetDescription className="sr-only">Record a payroll entry</SheetDescription>
        <EntryForm month={month} onDone={onClose} onCreated={onCreated} />
      </SheetContent>
    </Sheet>
  )
}

const AMOUNTS = [
  ['gross', 'Gross'],
  ['deductions', 'Deductions'],
  ['net', 'Net pay'],
  ['employer_costs', 'Employer costs'],
] as const

function EntryForm({
  entry,
  month = '',
  onDone,
  onCreated,
}: {
  entry?: PayrollEntry
  month?: string
  onDone: () => void
  onCreated?: (entry: PayrollEntry) => void
}) {
  const [values, setValues] = useState(() => (entry ? valuesOf(entry) : blankValues(month)))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [stale, setStale] = useState(false)
  const save = useSaveEntry()
  const people = useEmployeeList({ search: '', status: 'all', department: null })
  const options = people.data?.data ?? []
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const setLine = (index: number, change: Partial<Line>) =>
    set(
      'components',
      values.components.map((line, at) => (at === index ? { ...line, ...change } : line)),
    )
  const describe = (key: keyof Values) => ({
    id: id(key),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${id(key)}-error` : undefined,
  })

  const submit = () => {
    setStale(false)
    save.mutate(
      { id: entry?.id, version: entry?.version, input: entryInput(values) },
      {
        onSuccess: (saved) => {
          toast.success(entry ? 'Entry saved.' : 'Entry recorded as a draft.')
          if (entry) onDone()
          else onCreated?.(saved)
        },
        onError: (error) => {
          const fields = apiFieldErrors(error)
          if (fields && Object.keys(fields).length > 0) setErrors(fields)
          else if (error.status === 409 && error.code === 'conflict') setStale(true)
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  const field = (key: keyof Values, label: string, input: ReactNode, required = false) => (
    <FormField id={id(key)} label={label} error={errors[key]} required={required}>
      {input}
    </FormField>
  )
  const text = (key: Exclude<keyof Values, 'components'>, type = 'text', extra = '') => (
    <input
      {...describe(key)}
      type={type}
      inputMode={
        type === 'text' && AMOUNTS.some(([amount]) => amount === key) ? 'decimal' : undefined
      }
      value={values[key]}
      onChange={(event) => set(key, event.target.value)}
      className={cn(inputClass, extra)}
    />
  )

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="grid shrink-0 gap-0.5 border-b px-5 py-4 md:px-6">
        <h2 className="text-lg font-semibold">{entry ? 'Edit entry' : 'New entry'}</h2>
        <p className="text-[13px] text-muted-foreground">
          Enter the figures your payroll provider computed. Leave a figure empty when it is not
          known.
        </p>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 md:p-6">
        {stale && (
          <Callout role="alert" tone="warning">
            {STALE}
          </Callout>
        )}
        {field(
          'employee_id',
          'Employee',
          <NativeSelect
            {...describe('employee_id')}
            value={values.employee_id}
            disabled={Boolean(entry?.supersedes_id) || options.length === 0}
            onChange={(event) => set('employee_id', event.target.value)}
          >
            <option value="" disabled>
              {options.length === 0 ? 'No employees yet' : 'Choose an employee'}
            </option>
            {options.map((person) => (
              <option key={person.id} value={person.id}>
                {fullName(person)}
                {person.employee_number ? ` (${person.employee_number})` : ''}
              </option>
            ))}
          </NativeSelect>,
          true,
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          {field('period_start', 'Period start', text('period_start', 'date'), true)}
          {field('period_end', 'Period end', text('period_end', 'date'), true)}
          {field('pay_date', 'Pay date', text('pay_date', 'date'))}
        </div>
        {field(
          'currency',
          'Currency',
          <Combobox
            id={id('currency')}
            value={values.currency}
            options={CURRENCY_OPTIONS}
            placeholder="Choose a currency"
            invalid={Boolean(errors.currency)}
            onChange={(code) => set('currency', code)}
          />,
          true,
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {AMOUNTS.map(([key, label]) => (
            <div key={key}>{field(key, label, text(key, 'text', 'text-right tabular-nums'))}</div>
          ))}
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 flex items-center gap-1 text-body-sm font-medium">
            Components
            <HelpTip label="About components">
              Optional lines that make up the totals. Each kind must add up to its total when both
              are given.
            </HelpTip>
          </legend>
          {values.components.map((line, index) => (
            <div key={line.key} className="flex items-center gap-2">
              <NativeSelect
                aria-label={`Component ${index + 1} kind`}
                value={line.kind}
                wrapperClassName="w-40 shrink-0"
                onChange={(event) => {
                  const kind = COMPONENT_KINDS.find((option) => option.value === event.target.value)
                  if (kind) setLine(index, { kind: kind.value })
                }}
              >
                {COMPONENT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </NativeSelect>
              <input
                aria-label={`Component ${index + 1} label`}
                value={line.label}
                placeholder="Salary"
                onChange={(event) => setLine(index, { label: event.target.value })}
                className={cn(inputClass, 'min-w-0 flex-1')}
              />
              <input
                aria-label={`Component ${index + 1} amount`}
                inputMode="decimal"
                value={line.amount}
                placeholder="0.00"
                onChange={(event) => setLine(index, { amount: event.target.value })}
                className={cn(inputClass, 'w-28 text-right tabular-nums')}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove component ${index + 1}`}
                    onClick={() =>
                      set(
                        'components',
                        values.components.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove line</TooltipContent>
              </Tooltip>
            </div>
          ))}
          {errors.components && <p className="text-xs text-destructive">{errors.components}</p>}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              set('components', [
                ...values.components,
                { key: newKey(), kind: 'earning', label: '', amount: '' },
              ])
            }
          >
            <Plus /> Add line
          </Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {field('source_ref', 'Source reference', text('source_ref'))}
          {field('note', 'Note', text('note'))}
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Recording an entry does not certify it.
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3 md:px-6">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
