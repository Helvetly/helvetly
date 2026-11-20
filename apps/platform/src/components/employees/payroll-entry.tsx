'use client'

import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField, HelpTip } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Check, CircleCheck, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Combobox, CURRENCY_OPTIONS, inputClass, NativeSelect } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { ApiError, errorMessage } from '@/lib/api'
import { formatPay, fullName, useEmployeeList, useEmploymentSettings } from '@/lib/employees'
import { translate } from '@/lib/i18n'
import {
  approvalBlock,
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
import { useSession } from '@/lib/queries'

import { DisabledTip, useHrAccess } from './hr-access'

const SHEET = 'w-full! max-w-none! gap-0 p-0 sm:w-[min(720px,100vw)]! dark:bg-card'
const STALE = translate('payrollStale')

export function EntryStatus({ entry }: { entry: PayrollEntry }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entry.status === 'approved' ? (
        <Badge tone="green">{translate('payrollApproved')}</Badge>
      ) : (
        <Badge>{translate('payrollDraft')}</Badge>
      )}
      {entry.status === 'approved' &&
        (entry.payment_status === 'paid' ? (
          <Badge tone="blue">{translate('payrollStatusPaid')}</Badge>
        ) : (
          <Badge tone="amber">{translate('payrollUnpaid')}</Badge>
        ))}
      {entry.superseded_by && <Badge tone="neutral">{translate('payrollCorrected')}</Badge>}
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
          {entry
            ? translate('payrollEntryFor', { name: entry.employee_name })
            : translate('payrollEntry')}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {translate('payrollEntryDescription')}
        </SheetDescription>
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
            <p className="text-title-sm">{translate('payrollEntryLoadFailed')}</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, translate('payrollThisEntry'))}
            </p>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {translate('close')}
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
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-title-sm font-medium tabular-nums">{value}</span>
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
  const hr = useHrAccess()
  const userId = useSession().data?.user.id
  const settings = useEmploymentSettings().data
  const approve = useApproveEntry()
  const payment = usePayment()
  const correct = useCorrectEntry()
  const remove = useDeleteEntry()
  const [stale, setStale] = useState(false)
  const [paidOn, setPaidOn] = useState(entry.pay_date ?? today())
  const [deleting, setDeleting] = useState(false)
  const current = !entry.superseded_by
  const draft = entry.status === 'draft'
  const shows = hr.seesPayrollWrites
  // Four-eyes: the person who entered the current figures cannot approve them.
  const blocked = approvalBlock(entry, userId, settings)
  const approveReason = hr.lockReason ?? blocked

  const failed = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409 && error.code === 'conflict')
      setStale(true)
    else if (error instanceof ApiError && error.code === 'second_approver_required')
      toast.error(
        settings && settings.payroll_approvers < 2
          ? `${translate('payrollYouEnteredThese')} ${translate('payrollNobodyElseCanApprove')}`
          : translate('payrollYouEnteredThese'),
      )
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
        onSuccess: () =>
          toast.success(translate(date ? 'payrollMarkedPaid' : 'payrollMarkedUnpaid')),
        onError: failed,
      },
    )
  const money = (value: string | null) => formatPay(value, entry.currency)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-start gap-3 border-b px-5 py-4 md:px-6">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="truncate text-lg font-semibold">
            {hr.readEmployees ? (
              <Link
                href={`/employees?id=${encodeURIComponent(entry.employee_id)}`}
                className="underline underline-offset-4"
              >
                {entry.employee_name}
              </Link>
            ) : (
              entry.employee_name
            )}
          </h2>
          <p className="text-body-sm text-muted-foreground">
            {formatDate(entry.period_start)} – {formatDate(entry.period_end)}
            {entry.pay_date &&
              ` · ${translate('payrollPaidOut', { date: formatDate(entry.pay_date) })}`}
          </p>
          <EntryStatus entry={entry} />
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

      <div className="grid content-start gap-4 p-5 md:p-6">
        {stale && (
          <Callout
            role="alert"
            tone="warning"
            actions={
              <Button size="sm" variant="outline" onClick={reload}>
                <RotateCcw /> {translate('payrollReload')}
              </Button>
            }
          >
            {STALE}
          </Callout>
        )}
        {entry.superseded_by && (
          <Callout tone="neutral">{translate('payrollSupersededNote')}</Callout>
        )}
        {entry.supersedes_id && draft && (
          <Callout tone="info">{translate('payrollCorrectionNote')}</Callout>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Figure label={translate('payrollGross')} value={money(entry.gross)} />
          <Figure label={translate('payrollDeductions')} value={money(entry.deductions)} />
          <Figure label={translate('payrollNetPay')} value={money(entry.net)} />
          <Figure label={translate('payrollEmployerCosts')} value={money(entry.employer_costs)} />
          <Figure label={translate('payrollTotalCost')} value={money(entry.total_cost)} />
        </div>
        {!entry.complete && (
          <p className="text-body-sm text-muted-foreground">{translate('payrollIncompleteNote')}</p>
        )}

        {entry.components.length > 0 && (
          <ul
            aria-label={translate('payrollComponents')}
            className="divide-y rounded-lg ring-1 ring-border"
          >
            {entry.components.map((component) => (
              <li
                key={`${component.kind}:${component.label}:${component.amount}`}
                className="flex items-center gap-3 px-3 py-2 text-body"
              >
                <span className="flex-1 truncate">{component.label}</span>
                <span className="text-caption text-muted-foreground">
                  {COMPONENT_KINDS.find((kind) => kind.value === component.kind)?.label}
                </span>
                <span className="tabular-nums">{money(component.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
          <dt className="text-muted-foreground">{translate('employeeSource')}</dt>
          <dd>
            {entry.source}
            {entry.source_ref && ` · ${entry.source_ref}`}
          </dd>
          {entry.paid_on && (
            <>
              <dt className="text-muted-foreground">{translate('payrollPaidOn')}</dt>
              <dd>{formatDate(entry.paid_on)}</dd>
            </>
          )}
          {entry.note && (
            <>
              <dt className="text-muted-foreground">{translate('payrollNote')}</dt>
              <dd className="whitespace-pre-wrap">{entry.note}</dd>
            </>
          )}
        </dl>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
          <span>{auditLine(entry)}</span>
          <HelpTip label={translate('payrollApprovalLabel')}>
            {translate('payrollApprovalTip')}
          </HelpTip>
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {draft && shows && (
            <DisabledTip reason={hr.lockReason}>
              <Button variant="outline" disabled={Boolean(hr.lockReason)} onClick={onEdit}>
                <Pencil /> {translate('employeeEdit')}
              </Button>
            </DisabledTip>
          )}
          {draft && shows && (
            <DisabledTip reason={approveReason}>
              <Button
                disabled={approve.isPending || Boolean(approveReason)}
                onClick={() =>
                  approve.mutate(entry, {
                    onSuccess: () => toast.success(translate('payrollApprovedToast')),
                    onError: failed,
                  })
                }
              >
                <CircleCheck /> {translate('payrollApprove')}
              </Button>
            </DisabledTip>
          )}
          {!draft && current && shows && entry.payment_status === 'unpaid' && (
            <span className="flex items-center gap-2">
              <input
                type="date"
                aria-label={translate('payrollPaymentDate')}
                value={paidOn}
                disabled={Boolean(hr.lockReason)}
                onChange={(event) => setPaidOn(event.target.value)}
                className={cn(inputClass, 'w-40')}
              />
              <DisabledTip reason={hr.lockReason}>
                <Button
                  disabled={payment.isPending || !paidOn || Boolean(hr.lockReason)}
                  onClick={() => pay(paidOn)}
                >
                  <Check /> {translate('payrollMarkPaid')}
                </Button>
              </DisabledTip>
            </span>
          )}
          {!draft && current && shows && entry.payment_status === 'paid' && (
            <DisabledTip reason={hr.lockReason}>
              <Button
                variant="outline"
                disabled={payment.isPending || Boolean(hr.lockReason)}
                onClick={() => pay(null)}
              >
                {translate('payrollMarkUnpaid')}
              </Button>
            </DisabledTip>
          )}
          {!draft && current && shows && (
            <DisabledTip reason={hr.lockReason}>
              <Button
                variant="outline"
                disabled={correct.isPending || Boolean(hr.lockReason)}
                onClick={() =>
                  correct.mutate(entry.id, {
                    onSuccess: (created) => {
                      toast.success(translate('payrollCorrectionStarted'))
                      onOpen(created.id)
                    },
                    onError: failed,
                  })
                }
              >
                <RotateCcw /> {translate('payrollCorrect')}
              </Button>
            </DisabledTip>
          )}
          {draft && shows && (
            <span className="ml-auto">
              <DisabledTip reason={hr.lockReason}>
                <Button
                  variant="destructive-ghost"
                  disabled={Boolean(hr.lockReason)}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 /> {translate('payrollDeleteDraft')}
                </Button>
              </DisabledTip>
            </span>
          )}
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title={translate('payrollDeleteDraftTitle')}
          body={translate('payrollDeleteDraftBody')}
          confirmLabel={translate('payrollDeleteDraft')}
          tone="destructive"
          onDecide={(approved) => {
            setDeleting(false)
            if (approved)
              remove.mutate(entry.id, {
                onSuccess: () => {
                  toast.success(translate('payrollDraftDeleted'))
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
        <SheetTitle className="sr-only">{translate('payrollNewEntry')}</SheetTitle>
        <SheetDescription className="sr-only">{translate('payrollRecordEntry')}</SheetDescription>
        <EntryForm month={month} onDone={onClose} onCreated={onCreated} />
      </SheetContent>
    </Sheet>
  )
}

const AMOUNTS = [
  ['gross', translate('payrollGross')],
  ['deductions', translate('payrollDeductions')],
  ['net', translate('payrollNetPay')],
  ['employer_costs', translate('payrollEmployerCosts')],
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
          toast.success(translate(entry ? 'payrollEntrySaved' : 'payrollEntryRecorded'))
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
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          {translate(entry ? 'payrollEditEntry' : 'payrollNewEntry')}
          <HelpTip label={translate('payrollFiguresLabel')}>
            {translate('payrollFiguresTip')}
          </HelpTip>
        </h2>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 md:p-6">
        {stale && (
          <Callout role="alert" tone="warning">
            {STALE}
          </Callout>
        )}
        {field(
          'employee_id',
          translate('payrollColEmployee'),
          <NativeSelect
            {...describe('employee_id')}
            value={values.employee_id}
            disabled={Boolean(entry?.supersedes_id) || options.length === 0}
            onChange={(event) => set('employee_id', event.target.value)}
          >
            <option value="" disabled>
              {translate(options.length === 0 ? 'payrollNoEmployees' : 'payrollChooseEmployee')}
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
          {field(
            'period_start',
            translate('payrollPeriodStart'),
            text('period_start', 'date'),
            true,
          )}
          {field('period_end', translate('payrollPeriodEnd'), text('period_end', 'date'), true)}
          {field('pay_date', translate('payrollPayDate'), text('pay_date', 'date'))}
        </div>
        {field(
          'currency',
          translate('payrollCurrency'),
          <Combobox
            id={id('currency')}
            value={values.currency}
            options={CURRENCY_OPTIONS}
            placeholder={translate('payrollChooseCurrency')}
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
            {translate('payrollComponents')}
            <HelpTip label={translate('payrollComponentsLabel')}>
              {translate('payrollComponentsTip')}
            </HelpTip>
          </legend>
          {values.components.map((line, index) => (
            <div key={line.key} className="flex items-center gap-2">
              <NativeSelect
                aria-label={translate('payrollComponentKind', { n: index + 1 })}
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
                aria-label={translate('payrollComponentLabel', { n: index + 1 })}
                value={line.label}
                placeholder={translate('payrollComponentPlaceholder')}
                onChange={(event) => setLine(index, { label: event.target.value })}
                className={cn(inputClass, 'min-w-0 flex-1')}
              />
              <input
                aria-label={translate('payrollComponentAmount', { n: index + 1 })}
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
                    aria-label={translate('payrollComponentRemove', { n: index + 1 })}
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
                <TooltipContent>{translate('payrollRemoveLine')}</TooltipContent>
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
            <Plus /> {translate('payrollAddLine')}
          </Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {field('source_ref', translate('payrollSourceRef'), text('source_ref'))}
          {field('note', translate('payrollNote'), text('note'))}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3 md:px-6">
        <Button type="button" variant="ghost" onClick={onDone}>
          {translate('cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? translate('employeeSaving') : translate('employeeSave')}
        </Button>
      </div>
    </form>
  )
}

const who = (name: string | null, userId: string | null) =>
  name ?? (userId ? translate('payrollAMember') : null)

/**
 * "Created by Anna · Approved by Luca" for the audit trail. A person without a name (email sign-in) has an id but
 * no name from the server: "a member", so the trail never goes silent.
 */
export function auditLine(entry: PayrollEntry): string {
  const created = who(entry.created_by, entry.created_by_id)
  const approved = who(entry.approved_by, entry.approved_by_id)
  return [
    created && translate('payrollCreatedBy', { name: created }),
    approved && translate('payrollApprovedBy', { name: approved }),
  ]
    .filter(Boolean)
    .join(' · ')
}
