'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { cn } from '@helvetly/ui/lib/utils'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import {
  Combobox,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  inputClass,
} from '@/components/clients/fields'
import { FormSection } from '@/components/form-section'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { ApiError, errorMessage } from '@/lib/api'
import {
  expensesApi,
  FOREIGN_VAT_HINT,
  isForeignVat,
  RATE_SOURCES,
  uploadReceipts,
  useExpenseCategories,
  useExpensePreview,
  useSaveExpense,
  type Expense,
} from '@/lib/expenses'
import { useHabits } from '@/lib/habits'
import {
  formatMoney,
  PAYMENT_METHODS,
  today as workspaceToday,
  useInvoiceSettings,
  VAT_RATES,
} from '@/lib/invoices'
import { useSession } from '@/lib/queries'

import { DuplicateWarning } from './duplicate-warning'
import {
  EXPENSE_HABITS,
  newValues,
  firstError,
  newLine,
  NOTE_MAX,
  serverFieldErrors,
  toInput,
  validate,
  valuesFromExpense,
  withSupplierCountry,
  type FieldErrors,
  type FormValues,
} from './expense-form-model'
import { ReceiptDrop, StagedReceipts } from './expense-receipts'

const twoDecimals = (code: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
    .maximumFractionDigits === 2

const fieldId = (field: string) => `expense-${field}`

function FormField({
  field,
  ...props
}: Omit<ComponentProps<typeof SharedField>, 'id'> & { field: string }) {
  return <SharedField id={fieldId(field)} {...props} />
}

const RATE_CHOICES = [...VAT_RATES, '0']
const NO_FILES: File[] = []

type ExpenseFormProps = {
  expense?: Expense
  /** Receipts dropped before the form opened (a new expense only). */
  initialFiles?: File[]
  onClose: () => void
  onSaved: (expense: Expense, created: boolean) => void
}

/** Creates or edits an expense in a drawer from the right; a booked one only takes its payment and note. */
export function ExpenseForm(props: ExpenseFormProps) {
  const settings = useInvoiceSettings()
  const categories = useExpenseCategories()
  if (!props.expense && !(settled(settings) && settled(categories)))
    return <FormSheetLoading title="New expense" onClose={props.onClose} />
  return <ExpenseFormBody {...props} />
}

function ExpenseFormBody({ expense, initialFiles = NO_FILES, onClose, onSaved }: ExpenseFormProps) {
  const settings = useInvoiceSettings().data
  const session = useSession().data
  const categories = useExpenseCategories()
  const baseCurrency = expense?.base.currency ?? settings?.currency ?? 'CHF'
  const registered = settings?.vat_registered ?? true
  const defaultRate = settings?.default_vat_rate ?? '8.1'
  const booked = expense !== undefined && expense.status !== 'draft'
  const today = workspaceToday()

  const { habits, remember } = useHabits()
  const [initial] = useState(() =>
    expense
      ? valuesFromExpense(expense)
      : newValues(
          baseCurrency,
          defaultRate,
          registered,
          habits,
          (categories.data ?? []).map((category) => category.id),
        ),
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [staged, setStaged] = useState<File[]>(initialFiles)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const save = useSaveExpense()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || staged !== initialFiles
  const foreign = values.currency !== baseCurrency
  // New input takes 2-decimal ISO codes only; a stored expense keeps the one it has.
  const currencyOptions = CURRENCY_OPTIONS.filter(
    (option) => twoDecimals(option.value) || option.value === expense?.currency,
  )
  const payer =
    values.paid_by_member_id && values.paid_by_member_id === expense?.paid_by_member?.id
      ? expense.paid_by_member
      : session?.user

  // The server computes the totals; ask it once typing pauses.
  const options = { userId: session?.user.id, baseCurrency, booked: false }
  const inputKey = booked ? null : JSON.stringify(toInput(values, options))
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setPreviewKey(inputKey), 350)
    return () => clearTimeout(timer)
  }, [inputKey])
  const preview = useExpensePreview(previewKey)
  const totals = booked ? expense : preview.data

  const focusStart = useEffectEvent(() =>
    document.getElementById(fieldId(booked ? 'paid' : 'supplier_name'))?.focus(),
  )
  useEffect(() => {
    const timer = setTimeout(focusStart, 60)
    return () => clearTimeout(timer)
  }, [])

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
      )
  }
  const setLine = (index: number, change: Partial<FormValues['lines'][number]>) => {
    setValues((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...change } : line)),
    }))
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`lines.${index}.`)),
      ),
    )
  }

  const showErrors = (found: FieldErrors) => {
    setErrors(found)
    const first = firstError(found)
    if (first) document.getElementById(fieldId(first))?.focus()
  }

  const submit = async (book: boolean) => {
    if (submitting.current) return
    const found = validate(values, today, book && !booked)
    if (Object.keys(found).length) return showErrors(found)
    submitting.current = true
    setBusy(true)
    try {
      let saved = await save.mutateAsync({
        id: expense?.id,
        input: toInput(values, { userId: session?.user.id, baseCurrency, booked }),
      })
      if (!expense) remember('expense', values, EXPENSE_HABITS)
      if (staged.length) {
        await uploadReceipts(saved.id, staged, () => {}).catch((error: unknown) =>
          toast.error(`Saved, but the receipt wasn’t uploaded: ${errorMessage(error)}`),
        )
        saved = (await expensesApi.get(saved.id)).data
      }
      if (book && !booked) {
        try {
          saved = (await expensesApi.book(saved.id)).data
        } catch (error) {
          // Saved as a draft; the reasons tell what booking still needs (usually the receipt).
          const reasons =
            error instanceof ApiError && Array.isArray(error.details.reasons)
              ? error.details.reasons.filter((reason) => typeof reason === 'string')
              : []
          toast.warning(
            `Saved as draft #${saved.number}. ${reasons.join(' ') || errorMessage(error)}`,
          )
          onSaved(saved, !expense)
          return
        }
      }
      toast.success(
        book && !booked
          ? `Expense #${saved.number} booked.`
          : expense
            ? `Expense #${saved.number} saved.`
            : `Draft #${saved.number} saved.`,
      )
      if (saved.duplicate_of)
        toast.warning(
          `Expense #${saved.duplicate_of.number} has the same supplier and receipt number.`,
        )
      onSaved(saved, !expense)
    } catch (error) {
      submitting.current = false
      setBusy(false)
      const fromServer =
        error instanceof ApiError && error.status === 422 ? serverFieldErrors(error.details) : {}
      if (Object.keys(fromServer).length) showErrors(fromServer)
      else toastError(error)
    }
  }

  // ⌘Enter / Ctrl+Enter saves (and books a draft that is complete) from anywhere in the form.
  const saveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (!(event.target instanceof Node) || !form.current?.contains(event.target)) return
    event.preventDefault()
    void submit(false)
  })
  useEffect(() => {
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [])

  // Closing mid-save would drop the answer: React Query skips a call's callbacks after unmount, so a
  // refusal (or the success toast) never shows and the typed data is gone.
  const requestClose = () => {
    if (busy) return
    if (dirty) setDiscarding(true)
    else onClose()
  }
  const describe = (field: string) => ({
    id: fieldId(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined,
  })
  const categoryOptions = (categories.data ?? []).map((category) => ({
    value: category.id,
    label: category.name,
    hint: category.account_code,
  }))
  const title = expense ? `Edit expense #${expense.number}` : 'New expense'

  const payment = (
    <FormSection title="Payment" description="Whether it is paid, and how.">
      <div className="flex items-center justify-between gap-4">
        <Segmented
          label="Payment"
          value={values.paid ? 'paid' : 'unpaid'}
          options={[
            { value: 'unpaid', label: 'Not paid yet' },
            { value: 'paid', label: 'Paid' },
          ]}
          onChange={(choice) => set('paid', choice === 'paid')}
        />
        <span id={fieldId('paid')} tabIndex={-1} />
      </div>
      {values.paid && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            field="paid_on"
            label="Paid on"
            error={errors.paid_on}
            tip="Leave empty to use the receipt’s date."
          >
            <input
              {...describe('paid_on')}
              type="date"
              max={today}
              value={values.paid_on}
              onChange={(event) => set('paid_on', event.target.value)}
              placeholder="YYYY-MM-DD"
              className={cn(inputClass, 'cursor-text tabular-nums')}
            />
          </FormField>
          <FormField field="payment_method" label="Method">
            <Combobox
              id={fieldId('payment_method')}
              value={values.payment_method}
              options={PAYMENT_METHODS.map((method) => ({
                value: method.value,
                label: method.label,
              }))}
              placeholder="How it was paid"
              onChange={(method) =>
                set('payment_method', PAYMENT_METHODS.find((m) => m.value === method)?.value ?? '')
              }
            />
          </FormField>
          <SwitchRow
            id={fieldId('out_of_pocket')}
            className="sm:col-span-2"
            label={
              payer && payer.id !== session?.user.id
                ? `Paid by ${payer.name} out of pocket`
                : 'I paid this myself'
            }
            description={`Out of pocket: the company owes it back to ${payer?.name ?? 'you'}.`}
            checked={values.out_of_pocket}
            onCheckedChange={(on) =>
              setValues((current) => ({
                ...current,
                out_of_pocket: on,
                paid_by_member_id: on ? (session?.user.id ?? '') : '',
              }))
            }
          />
          {values.out_of_pocket && (
            <FormField
              field="reimbursed_on"
              label="Reimbursed on"
              error={errors.reimbursed_on}
              tip="When the company paid it back."
            >
              <input
                {...describe('reimbursed_on')}
                type="date"
                max={today}
                value={values.reimbursed_on}
                onChange={(event) => set('reimbursed_on', event.target.value)}
                placeholder="YYYY-MM-DD"
                className={cn(inputClass, 'cursor-text tabular-nums')}
              />
            </FormField>
          )}
        </div>
      )}
    </FormSection>
  )

  const note = (
    <FormField
      field="note"
      label="Internal note"
      error={errors.note}
      hint={
        <span className="flex justify-between">
          Only your team sees this.
          <span className={cn('tabular-nums', values.note.length > NOTE_MAX && 'text-destructive')}>
            {values.note.length} / {NOTE_MAX}
          </span>
        </span>
      }
    >
      <textarea
        {...describe('note')}
        rows={2}
        value={values.note}
        onChange={(event) => set('note', event.target.value)}
        placeholder="Anything your team or your accountant should know"
        className={cn(inputClass, 'h-auto min-h-16 resize-y py-2')}
      />
    </FormField>
  )

  const body = (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit(!booked)
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-8">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <p className="text-[13px] text-muted-foreground">
            {booked
              ? 'Booked: the amounts are part of your books now.'
              : 'Save a draft any time; booking needs the starred fields and a receipt.'}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {booked ? (
          <>
            <div className="border-b border-border/60 px-5 py-6 md:px-8">
              <output className="flex max-w-[800px] items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" />
                Supplier, amounts and receipts are locked once booked. To correct them, void this
                expense and book a corrected copy.
              </output>
            </div>
            {payment}
            <FormSection title="Note" description="Only visible to your team.">
              {note}
            </FormSection>
          </>
        ) : (
          <>
            {!expense && (
              <FormSection title="Receipt" description="Attach it now or later; booking needs one.">
                {staged.length ? (
                  <StagedReceipts
                    files={staged}
                    onRemove={(file) => setStaged(staged.filter((entry) => entry !== file))}
                  />
                ) : (
                  <ReceiptDrop onFiles={(files) => setStaged(files)} compact />
                )}
              </FormSection>
            )}

            <FormSection title="Details" description="Who you paid, when, and for what.">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  field="supplier_name"
                  label="Supplier"
                  error={errors.supplier_name}
                  required
                  className="sm:col-span-2"
                >
                  <input
                    {...describe('supplier_name')}
                    value={values.supplier_name}
                    onChange={(event) => set('supplier_name', event.target.value)}
                    placeholder="Swisscom (Schweiz) AG"
                    autoComplete="off"
                    className={inputClass}
                  />
                </FormField>
                <FormField
                  field="document_date"
                  label="Receipt date"
                  error={errors.document_date}
                  required
                >
                  <input
                    {...describe('document_date')}
                    type="date"
                    max={today}
                    value={values.document_date}
                    onChange={(event) => set('document_date', event.target.value)}
                    placeholder="YYYY-MM-DD"
                    className={cn(inputClass, 'cursor-text tabular-nums')}
                  />
                </FormField>
                <FormField
                  field="due_date"
                  label="Due date"
                  error={errors.due_date}
                  tip="For supplier invoices you pay later; unpaid ones past it show as overdue."
                >
                  <input
                    {...describe('due_date')}
                    type="date"
                    min={values.document_date || undefined}
                    value={values.due_date}
                    onChange={(event) => set('due_date', event.target.value)}
                    placeholder="YYYY-MM-DD"
                    className={cn(inputClass, 'cursor-text tabular-nums')}
                  />
                </FormField>
                <FormField
                  field="category_id"
                  label="Category"
                  error={errors.category_id}
                  required
                  tip="Each category books to an account of the Swiss SME chart of accounts (KMU-Kontenrahmen)."
                >
                  <Combobox
                    id={fieldId('category_id')}
                    value={values.category_id}
                    options={categoryOptions}
                    invalid={Boolean(errors.category_id)}
                    placeholder={categories.isPending ? 'Loading categories…' : 'Choose a category'}
                    renderValue={(option) => (
                      <span>
                        {option.label}{' '}
                        <span className="text-muted-foreground tabular-nums">{option.hint}</span>
                      </span>
                    )}
                    onChange={(id) => set('category_id', id)}
                  />
                </FormField>
                <FormField field="reference" label="Invoice / receipt no." error={errors.reference}>
                  <input
                    {...describe('reference')}
                    value={values.reference}
                    onChange={(event) => set('reference', event.target.value)}
                    placeholder="R-2026-0412"
                    className={inputClass}
                  />
                </FormField>
                <DuplicateWarning duplicate={expense?.duplicate_of ?? null} />
                <FormField
                  field="supplier_country"
                  label="Supplier country"
                  tip="Where the supplier charged its VAT. Only Swiss and Liechtenstein VAT is reclaimable as Swiss input tax."
                >
                  <Combobox
                    id={fieldId('supplier_country')}
                    value={values.supplier_country}
                    options={COUNTRY_OPTIONS}
                    placeholder="Choose a country"
                    onChange={(code) => {
                      setValues((current) => withSupplierCountry(current, code, registered))
                    }}
                  />
                </FormField>
                <FormField
                  field="supplier_vat_number"
                  label="Supplier VAT / UID"
                  error={errors.supplier_vat_number}
                  tip="Printed on the receipt, e.g. CHE-123.456.789 MWST. Needed for input tax above CHF 400."
                >
                  <input
                    {...describe('supplier_vat_number')}
                    value={values.supplier_vat_number}
                    onChange={(event) => set('supplier_vat_number', event.target.value)}
                    placeholder="CHE-123.456.789 MWST"
                    className={cn(inputClass, 'font-mono text-[13px]')}
                  />
                </FormField>
                <FormField
                  field="description"
                  label="What for"
                  error={errors.description}
                  className="sm:col-span-2"
                >
                  <input
                    {...describe('description')}
                    value={values.description}
                    onChange={(event) => set('description', event.target.value)}
                    placeholder="Mobile subscription, October"
                    className={inputClass}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection
              title="Amounts"
              description="What the receipt adds up to, line by line."
              action={
                <Segmented
                  label="Amounts are"
                  value={values.amount_mode}
                  options={[
                    { value: 'gross', label: 'Incl. VAT' },
                    { value: 'net', label: 'Excl. VAT' },
                  ]}
                  onChange={(mode) => set('amount_mode', mode)}
                />
              }
            >
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_92px_32px] gap-2 text-[13px] font-medium max-sm:grid-cols-[minmax(0,1fr)_110px_84px_32px]">
                  <span>Item</span>
                  <span>
                    Amount
                    <span aria-hidden className="ml-0.5 text-destructive">
                      *
                    </span>
                  </span>
                  <span>VAT %</span>
                  <span />
                </div>
                {values.lines.map((line, index) => (
                  <div key={line.key} className="grid gap-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_120px_92px_32px] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_110px_84px_32px]">
                      <input
                        aria-label={`Line ${index + 1} description`}
                        value={line.description}
                        onChange={(event) => setLine(index, { description: event.target.value })}
                        placeholder={index === 0 ? 'Optional, e.g. Hotel' : 'e.g. Breakfast'}
                        className={inputClass}
                      />
                      <input
                        {...describe(`lines.${index}.amount`)}
                        aria-label={`Line ${index + 1} amount`}
                        inputMode="decimal"
                        value={line.amount}
                        onChange={(event) => setLine(index, { amount: event.target.value })}
                        placeholder="0.00"
                        className={cn(inputClass, 'text-right tabular-nums')}
                      />
                      <input
                        {...describe(`lines.${index}.vat_rate`)}
                        aria-label={`Line ${index + 1} VAT rate`}
                        inputMode="decimal"
                        list="expense-vat-rates"
                        value={line.vat_rate}
                        onChange={(event) => setLine(index, { vat_rate: event.target.value })}
                        placeholder="8.1"
                        className={cn(inputClass, 'text-right tabular-nums')}
                      />
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="icon-sm"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={values.lines.length === 1}
                        className="cursor-pointer"
                        onClick={() =>
                          set(
                            'lines',
                            values.lines.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {(errors[`lines.${index}.amount`] ?? errors[`lines.${index}.vat_rate`]) && (
                      <p
                        id={`${fieldId(`lines.${index}.amount`)}-error`}
                        className="text-xs text-destructive"
                      >
                        {errors[`lines.${index}.amount`] ?? errors[`lines.${index}.vat_rate`]}
                      </p>
                    )}
                  </div>
                ))}
                <datalist id="expense-vat-rates">
                  {RATE_CHOICES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} %
                    </option>
                  ))}
                </datalist>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={values.lines.length >= 20}
                  className="cursor-pointer justify-self-start text-muted-foreground"
                  onClick={() =>
                    set('lines', [...values.lines, newLine(registered ? defaultRate : '0')])
                  }
                >
                  <Plus /> Add a line for another VAT rate
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField field="currency" label="Currency">
                  <Combobox
                    id={fieldId('currency')}
                    value={values.currency}
                    options={currencyOptions}
                    renderValue={(option) => `${option.value} · ${option.label}`}
                    placeholder="Choose a currency"
                    onChange={(code) => set('currency', code)}
                  />
                </FormField>
                {foreign && (
                  <>
                    <FormField
                      field="exchange_rate"
                      label={`${baseCurrency} per 1 ${values.currency}`}
                      error={errors.exchange_rate}
                      required
                      tip="The rate you book with: the ESTV rate for VAT, or what your bank charged."
                    >
                      <input
                        {...describe('exchange_rate')}
                        inputMode="decimal"
                        value={values.exchange_rate}
                        onChange={(event) => set('exchange_rate', event.target.value)}
                        placeholder="0.9412"
                        className={cn(inputClass, 'text-right tabular-nums')}
                      />
                    </FormField>
                    <div className="grid grid-cols-2 gap-2">
                      <FormField field="exchange_rate_date" label="Rate date">
                        <input
                          {...describe('exchange_rate_date')}
                          type="date"
                          value={values.exchange_rate_date}
                          onChange={(event) => set('exchange_rate_date', event.target.value)}
                          placeholder="YYYY-MM-DD"
                          className={cn(inputClass, 'cursor-text px-2 tabular-nums')}
                        />
                      </FormField>
                      <FormField field="exchange_rate_source" label="Source">
                        <Combobox
                          id={fieldId('exchange_rate_source')}
                          value={values.exchange_rate_source}
                          options={RATE_SOURCES.map((source) => ({
                            value: source.value,
                            label: source.label,
                          }))}
                          placeholder="Source"
                          contentClassName="w-56"
                          onChange={(source) =>
                            set(
                              'exchange_rate_source',
                              RATE_SOURCES.find((s) => s.value === source)?.value ?? '',
                            )
                          }
                        />
                      </FormField>
                    </div>
                  </>
                )}
              </div>

              <Totals expense={totals} foreign={foreign} loading={preview.isFetching} />
            </FormSection>

            <FormSection title="Input tax" description="How much of the VAT you can reclaim.">
              <FormField
                field="deductible_percent"
                label="Reclaimable VAT"
                error={errors.deductible_percent}
                hint={isForeignVat(values.supplier_country) ? FOREIGN_VAT_HINT : undefined}
                tip="Input tax (Vorsteuer): full for business costs, partial for mixed private use, none when you are not VAT-registered or it is excluded (e.g. 50% of entertainment)."
              >
                <div className="flex min-h-9 flex-wrap items-center gap-2">
                  <Segmented
                    label="Reclaimable VAT"
                    value={values.input_tax}
                    options={[
                      { value: 'full', label: 'Full' },
                      { value: 'partial', label: 'Partial' },
                      { value: 'none', label: 'None' },
                    ]}
                    onChange={(choice) => {
                      set('input_tax', choice)
                      set(
                        'deductible_percent',
                        choice === 'full' ? '100' : choice === 'none' ? '0' : '50',
                      )
                    }}
                  />
                  {values.input_tax === 'partial' && (
                    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <input
                        {...describe('deductible_percent')}
                        inputMode="decimal"
                        value={values.deductible_percent}
                        onChange={(event) => set('deductible_percent', event.target.value)}
                        placeholder="50"
                        aria-label="Deductible share in percent"
                        className={cn(inputClass, 'w-20 text-right tabular-nums')}
                      />
                      %
                    </span>
                  )}
                </div>
              </FormField>
            </FormSection>

            {payment}

            <FormSection title="Notes" description="For your team and your accountant.">
              {note}
              <FormField
                field="receipt_missing_reason"
                label="No receipt?"
                tip="A substitute receipt (Ersatzbeleg): say what was bought, where and why the original is missing."
              >
                <input
                  {...describe('receipt_missing_reason')}
                  value={values.receipt_missing_reason}
                  onChange={(event) => set('receipt_missing_reason', event.target.value)}
                  placeholder="e.g. Parking meter, no receipt issued"
                  className={inputClass}
                />
              </FormField>
            </FormSection>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
        <span className="hidden text-xs text-muted-foreground sm:block">
          <kbd className="font-sans">⌘</kbd> Enter to save
        </span>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto cursor-pointer"
          onClick={requestClose}
        >
          Cancel
        </Button>
        {booked ? (
          <Button type="submit" disabled={busy} className="cursor-pointer">
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="cursor-pointer"
              onClick={() => void submit(false)}
            >
              Save draft
            </Button>
            <Button type="submit" disabled={busy} className="cursor-pointer">
              {busy ? 'Saving…' : 'Save and book'}
            </Button>
          </>
        )}
      </div>

      {discarding && (
        <ConfirmDialog
          title="Discard your changes?"
          body="What you entered in this form will be lost."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          tone="destructive"
          onDecide={(discard) => {
            setDiscarding(false)
            if (discard) onClose()
          }}
        />
      )}
    </form>
  )

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">Expense details</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  )
}

/** Net, VAT, gross and the reclaimable part, as the server computed them. */
function Totals({
  expense,
  foreign,
  loading,
}: {
  expense: Expense | undefined
  foreign: boolean
  loading: boolean
}) {
  if (!expense) return null
  const rows = [
    { label: 'Net', value: formatMoney(expense.net_total, expense.currency) },
    ...expense.vat_breakdown
      .filter((group) => group.rate !== '0')
      .map((group) => ({
        label: `VAT ${group.rate}% on ${formatMoney(group.taxable_amount, expense.currency)}`,
        value: formatMoney(group.vat_amount, expense.currency),
      })),
  ]
  return (
    <div
      aria-live="polite"
      className={cn(
        'grid gap-1.5 rounded-lg px-4 py-3 text-[13.5px] ring-1 ring-border transition-opacity',
        loading && 'opacity-60',
      )}
    >
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4 text-muted-foreground">
          <span>{row.label}</span>
          <span className="tabular-nums">{row.value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-border/70 pt-1.5 text-[15px] font-medium">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(expense.total, expense.currency)}</span>
      </div>
      {foreign && (
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>In {expense.base.currency}</span>
          <span className="tabular-nums">
            {formatMoney(expense.base.total, expense.base.currency)}
          </span>
        </div>
      )}
      <div className="flex justify-between gap-4 text-success">
        <span>Reclaimable input tax</span>
        <span className="tabular-nums">
          {formatMoney(expense.base.deductible_vat, expense.base.currency)}
        </span>
      </div>
    </div>
  )
}
