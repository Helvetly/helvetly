'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Calculator,
  CreditCard,
  FileText,
  Lock,
  Paperclip,
  Percent,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { promptUpgrade, toastError } from '@/components/billing/upgrade-prompt'
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
  canRecognize,
  FOREIGN_VAT_HINT,
  isForeignVat,
  isHeic,
  RATE_SOURCES,
  recognizeReceipt,
  uploadReceipts,
  useExpenseCategories,
  useExpensePreview,
  useSaveExpense,
  type Expense,
} from '@/lib/expenses'
import { preferred, useHabits } from '@/lib/habits'
import { translate } from '@/lib/i18n'
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
import { applyRecognition, type Applied } from './expense-form-recognition'
import { ReceiptDrop, StagedReceipts } from './expense-receipts'

const twoDecimals = (code: string) =>
  new Intl.NumberFormat(languageTag, { style: 'currency', currency: code }).resolvedOptions()
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

const recognizedLabel = (field: string) =>
  ({
    supplier_name: translate('supplier'),
    supplier_vat_number: translate('supplierVATUID'),
    supplier_country: translate('supplierCountry'),
    reference: translate('invoiceReceiptNo'),
    description: translate('whatFor'),
    document_date: translate('receiptDate'),
    due_date: translate('dueDate'),
    amounts: translate('amounts'),
  })[field] ?? field

/** What the last Recognize receipt did, for the review note under the receipt. */
type Recognized = (Pick<Applied, 'applied' | 'kept'> & { issues: string[] }) | { error: string }

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
    return <FormSheetLoading title={translate('newExpense')} onClose={props.onClose} />
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
  // A saved country (even CH) is the person's choice; without one, CH is only the form's fallback.
  const [countrySaved] = useState(
    () => !expense && preferred(habits, 'expense.supplier_country') !== null,
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [staged, setStaged] = useState<File[]>(initialFiles)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  // Receipt recognition: one chosen file, one request at a time; `touched` is every field the person ever edited.
  const touched = useRef(new Set<string>())
  const [chosen, setChosen] = useState<File | null>(null)
  const [reading, setReading] = useState<File | null>(null)
  const [recognized, setRecognized] = useState<Recognized | null>(null)
  const reader = useRef<AbortController | null>(null)
  // The workspace a result belongs to: a switch while reading makes it stale.
  const workspaceId = session?.workspace.id
  const currentWorkspace = useRef(workspaceId)
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

  const latest = useRef(values)
  useEffect(() => {
    latest.current = values
    if (currentWorkspace.current !== workspaceId) reader.current?.abort() // a switch abandons the reading
    currentWorkspace.current = workspaceId
  })
  // Closing the form abandons a reading in flight too (its usage is still counted server-side).
  useEffect(() => () => reader.current?.abort(), [])
  const recognizable = staged.length === 1 ? staged[0] : staged.find((file) => file === chosen)
  const stopReading = () => {
    reader.current?.abort()
    reader.current = null
    setReading(null)
    setRecognized(null)
  }
  const recognize = async (file: File) => {
    if (reader.current || expense) return // recognition fills a new expense only
    const controller = new AbortController()
    const startedIn = workspaceId
    reader.current = controller
    setReading(file)
    setRecognized(null)
    try {
      const suggestions = await recognizeReceipt(file, crypto.randomUUID(), controller.signal)
      // Removed, replaced, closed or another workspace meanwhile: the answer is not applied.
      if (
        controller.signal.aborted ||
        reader.current !== controller ||
        currentWorkspace.current !== startedIn
      )
        return
      const result = applyRecognition(latest.current, initial, touched.current, suggestions, {
        registered,
        countrySaved,
        currencyOk: (code) => currencyOptions.some((option) => option.value === code),
      })
      setValues(result.values)
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([key]) =>
              !result.applied.some((field) =>
                field === 'amounts' ? key.startsWith('lines') : key === field,
              ),
          ),
        ),
      )
      setRecognized({
        applied: result.applied,
        kept: result.kept,
        issues: Object.values(suggestions.issues),
      })
    } catch (error) {
      if (controller.signal.aborted || reader.current !== controller) return
      if (!promptUpgrade(error)) setRecognized({ error: errorMessage(error) })
    } finally {
      if (reader.current === controller) {
        reader.current = null
        setReading(null)
      }
    }
  }
  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    touched.current.add(field)
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
      )
  }
  const setLine = (index: number, change: Partial<FormValues['lines'][number]>) => {
    touched.current.add('lines')
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
    if (submitting.current || reader.current) return
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
          toast.error(
            translate('savedButTheReceiptWasnTUploaded', { value1: errorMessage(error) }),
          ),
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
            translate('savedAsDraft', {
              number: saved.number,
              value2: reasons.join(' ') || errorMessage(error),
            }),
          )
          onSaved(saved, !expense)
          return
        }
      }
      toast.success(
        book && !booked
          ? translate('expenseBooked', { number: saved.number })
          : expense
            ? translate('expenseSaved', { number: saved.number })
            : translate('draftSaved', { number: saved.number }),
      )
      if (saved.duplicate_of)
        toast.warning(
          translate('expenseHasTheSameSupplierAndReceiptNumber', {
            number: saved.duplicate_of.number,
          }),
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
  const title = expense
    ? translate('editExpense', { number: expense.number })
    : translate('newExpense')

  const payment = (
    <FormSection
      icon={CreditCard}
      title={translate('payment')}
      description={translate('whetherItIsPaidAndHow')}
    >
      <div className="flex items-center justify-between gap-4">
        <Segmented
          label={translate('payment')}
          value={values.paid ? 'paid' : 'unpaid'}
          options={[
            { value: 'unpaid', label: translate('notPaidYet') },
            { value: 'paid', label: translate('paid') },
          ]}
          onChange={(choice) => set('paid', choice === 'paid')}
        />
        <span id={fieldId('paid')} tabIndex={-1} />
      </div>
      {values.paid && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            field="paid_on"
            label={translate('paidOn')}
            error={errors.paid_on}
            tip={translate('leaveEmptyToUseTheReceiptSDate')}
          >
            <input
              {...describe('paid_on')}
              type="date"
              max={today}
              value={values.paid_on}
              onChange={(event) => set('paid_on', event.target.value)}
              placeholder={translate('yyyyMMDD')}
              className={cn(inputClass, 'cursor-text tabular-nums')}
            />
          </FormField>
          <FormField field="payment_method" label={translate('method')}>
            <Combobox
              id={fieldId('payment_method')}
              value={values.payment_method}
              options={PAYMENT_METHODS.map((method) => ({
                value: method.value,
                label: method.label,
              }))}
              placeholder={translate('howItWasPaid')}
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
                ? translate('paidByOutOfPocket', { name: payer.name })
                : translate('iPaidThisMyself')
            }
            description={translate('outOfPocketTheCompanyOwesItBackTo', {
              value1: payer?.name ?? translate('you'),
            })}
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
              label={translate('reimbursedOn')}
              error={errors.reimbursed_on}
              tip={translate('whenTheCompanyPaidItBack')}
            >
              <input
                {...describe('reimbursed_on')}
                type="date"
                max={today}
                value={values.reimbursed_on}
                onChange={(event) => set('reimbursed_on', event.target.value)}
                placeholder={translate('yyyyMMDD')}
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
      label={translate('internalNote')}
      error={errors.note}
      hint={
        <span className="flex justify-between">
          {translate('onlyYourTeamSeesThis')}
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
        placeholder={translate('anythingYourTeamOrYourAccountantShouldKnow')}
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
              ? translate('bookedTheAmountsArePartOfYourBooksNow')
              : translate('saveADraftAnyTimeBookingNeedsTheStarred')}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {booked ? (
          <>
            <div className="border-b border-border/60 px-5 py-6 md:px-8">
              <output className="flex max-w-[800px] items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5 text-[13px] text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" />
                {translate('supplierAmountsAndReceiptsAreLockedOnceBookedTo')}
              </output>
            </div>
            {payment}
            <FormSection
              icon={StickyNote}
              title={translate('note')}
              description={translate('onlyVisibleToYourTeam')}
            >
              {note}
            </FormSection>
          </>
        ) : (
          <>
            {!expense && (
              <FormSection
                icon={Paperclip}
                title={translate('receipt')}
                description={translate('attachItNowOrLaterBookingNeedsOne')}
              >
                {staged.length ? (
                  <>
                    <StagedReceipts
                      files={staged}
                      onRemove={(file) => {
                        if (file === reading) stopReading()
                        if (file === chosen) setChosen(null)
                        setStaged(staged.filter((entry) => entry !== file))
                      }}
                    />
                    <div className="grid gap-2">
                      {staged.length > 1 && (
                        <Combobox
                          id={fieldId('recognize_receipt')}
                          value={recognizable ? String(staged.indexOf(recognizable)) : ''}
                          options={staged.map((file, index) => ({
                            value: String(index),
                            label: file.name,
                          }))}
                          placeholder={translate('chooseTheReceiptToRead')}
                          onChange={(index) => {
                            stopReading() // a reading of the previously chosen receipt must not fill the form
                            setChosen(staged[Number(index)] ?? null)
                          }}
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            !recognizable || reading !== null || !canRecognize(recognizable)
                          }
                          className="cursor-pointer"
                          onClick={() => recognizable && void recognize(recognizable)}
                        >
                          <Sparkles />
                          {reading ? translate('readingTheReceipt') : translate('recognizeReceipt')}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {translate('recognizeReceiptNotice')}
                        </span>
                      </div>
                      {recognizable && isHeic(recognizable) && (
                        <p className="text-xs text-muted-foreground">
                          {translate('heicCantBeRead')}
                        </p>
                      )}
                      <output
                        aria-live="polite"
                        className="grid gap-1 text-xs text-muted-foreground empty:hidden"
                      >
                        {recognized && 'error' in recognized && (
                          <span className="text-destructive">
                            {translate('receiptReadFailed', { reason: recognized.error })}
                          </span>
                        )}
                        {recognized && 'applied' in recognized && (
                          <>
                            {recognized.applied.length > 0 && (
                              <span>
                                {translate('filledInFromTheReceipt', {
                                  fields: recognized.applied.map(recognizedLabel).join(', '),
                                })}
                              </span>
                            )}
                            {recognized.kept.length > 0 && (
                              <span>
                                {translate('keptYourEntries', {
                                  fields: recognized.kept.map(recognizedLabel).join(', '),
                                })}
                              </span>
                            )}
                            {recognized.issues.length > 0 && (
                              <span>
                                {translate('checkTheseFromTheReceipt', {
                                  issues: recognized.issues.join(' '),
                                })}
                              </span>
                            )}
                            {!recognized.applied.length &&
                              !recognized.kept.length &&
                              !recognized.issues.length && (
                                <span>{translate('nothingNewReadFromTheReceipt')}</span>
                              )}
                          </>
                        )}
                      </output>
                    </div>
                  </>
                ) : (
                  <ReceiptDrop onFiles={(files) => setStaged(files)} compact />
                )}
              </FormSection>
            )}

            <FormSection
              icon={FileText}
              title={translate('details')}
              description={translate('whoYouPaidWhenAndForWhat')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  field="supplier_name"
                  label={translate('supplier')}
                  error={errors.supplier_name}
                  required
                  className="sm:col-span-2"
                >
                  <input
                    {...describe('supplier_name')}
                    value={values.supplier_name}
                    onChange={(event) => set('supplier_name', event.target.value)}
                    placeholder={translate('swisscomSchweizAG')}
                    autoComplete="off"
                    className={inputClass}
                  />
                </FormField>
                <FormField
                  field="document_date"
                  label={translate('receiptDate')}
                  error={errors.document_date}
                  required
                >
                  <input
                    {...describe('document_date')}
                    type="date"
                    max={today}
                    value={values.document_date}
                    onChange={(event) => set('document_date', event.target.value)}
                    placeholder={translate('yyyyMMDD')}
                    className={cn(inputClass, 'cursor-text tabular-nums')}
                  />
                </FormField>
                <FormField
                  field="due_date"
                  label={translate('dueDate')}
                  error={errors.due_date}
                  tip={translate('forSupplierInvoicesYouPayLaterUnpaidOnesPast')}
                >
                  <input
                    {...describe('due_date')}
                    type="date"
                    min={values.document_date || undefined}
                    value={values.due_date}
                    onChange={(event) => set('due_date', event.target.value)}
                    placeholder={translate('yyyyMMDD')}
                    className={cn(inputClass, 'cursor-text tabular-nums')}
                  />
                </FormField>
                <FormField
                  field="category_id"
                  label={translate('category')}
                  error={errors.category_id}
                  required
                  tip={translate('eachCategoryBooksToAnAccountOfTheSwiss')}
                >
                  <Combobox
                    id={fieldId('category_id')}
                    value={values.category_id}
                    options={categoryOptions}
                    invalid={Boolean(errors.category_id)}
                    placeholder={
                      categories.isPending
                        ? translate('loadingCategories')
                        : translate('chooseACategory')
                    }
                    renderValue={(option) => (
                      <span>
                        {option.label}{' '}
                        <span className="text-muted-foreground tabular-nums">{option.hint}</span>
                      </span>
                    )}
                    onChange={(id) => set('category_id', id)}
                  />
                </FormField>
                <FormField
                  field="reference"
                  label={translate('invoiceReceiptNo')}
                  error={errors.reference}
                >
                  <input
                    {...describe('reference')}
                    value={values.reference}
                    onChange={(event) => set('reference', event.target.value)}
                    placeholder={translate('r20260412')}
                    className={inputClass}
                  />
                </FormField>
                <DuplicateWarning duplicate={expense?.duplicate_of ?? null} />
                <FormField
                  field="supplier_country"
                  label={translate('supplierCountry')}
                  tip={translate('whereTheSupplierChargedItsVATOnlySwissAnd')}
                >
                  <Combobox
                    id={fieldId('supplier_country')}
                    value={values.supplier_country}
                    options={COUNTRY_OPTIONS}
                    placeholder={translate('chooseACountry2')}
                    onChange={(code) => {
                      for (const field of ['supplier_country', 'input_tax', 'deductible_percent'])
                        touched.current.add(field)
                      setValues((current) => withSupplierCountry(current, code, registered))
                    }}
                  />
                </FormField>
                <FormField
                  field="supplier_vat_number"
                  label={translate('supplierVATUID')}
                  error={errors.supplier_vat_number}
                  tip={translate('printedOnTheReceiptEGCHE123456')}
                >
                  <input
                    {...describe('supplier_vat_number')}
                    value={values.supplier_vat_number}
                    onChange={(event) => set('supplier_vat_number', event.target.value)}
                    placeholder={translate('che123456789MWST')}
                    className={cn(inputClass, 'font-mono text-[13px]')}
                  />
                </FormField>
                <FormField
                  field="description"
                  label={translate('whatFor')}
                  error={errors.description}
                  className="sm:col-span-2"
                >
                  <input
                    {...describe('description')}
                    value={values.description}
                    onChange={(event) => set('description', event.target.value)}
                    placeholder={translate('mobileSubscriptionOctober')}
                    className={inputClass}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection
              icon={Calculator}
              title={translate('amounts')}
              description={translate('whatTheReceiptAddsUpToLineByLine')}
              action={
                <Segmented
                  label={translate('amountsAre')}
                  value={values.amount_mode}
                  options={[
                    { value: 'gross', label: translate('inclVAT') },
                    { value: 'net', label: translate('exclVAT') },
                  ]}
                  onChange={(mode) => set('amount_mode', mode)}
                />
              }
            >
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_92px_32px] gap-2 text-[13px] font-medium max-sm:grid-cols-[minmax(0,1fr)_110px_84px_32px]">
                  <span>{translate('item')}</span>
                  <span>
                    {translate('amount')}
                    <span aria-hidden className="ml-0.5 text-destructive">
                      *
                    </span>
                  </span>
                  <span>{translate('vat2')}</span>
                  <span />
                </div>
                {values.lines.map((line, index) => (
                  <div key={line.key} className="grid gap-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_120px_92px_32px] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_110px_84px_32px]">
                      <input
                        aria-label={translate('lineDescription', { value1: index + 1 })}
                        value={line.description}
                        onChange={(event) => setLine(index, { description: event.target.value })}
                        placeholder={
                          index === 0 ? translate('optionalEGHotel') : translate('eGBreakfast')
                        }
                        className={inputClass}
                      />
                      <input
                        {...describe(`lines.${index}.amount`)}
                        aria-label={translate('lineAmount', { value1: index + 1 })}
                        inputMode="decimal"
                        value={line.amount}
                        onChange={(event) => setLine(index, { amount: event.target.value })}
                        placeholder="0.00"
                        className={cn(inputClass, 'text-right tabular-nums')}
                      />
                      <input
                        {...describe(`lines.${index}.vat_rate`)}
                        aria-label={translate('lineVATRate', { value1: index + 1 })}
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
                        aria-label={translate('removeLine', { value1: index + 1 })}
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
                  <Plus />
                  {translate('addALineForAnotherVATRate')}
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField field="currency" label={translate('currency')}>
                  <Combobox
                    id={fieldId('currency')}
                    value={values.currency}
                    options={currencyOptions}
                    renderValue={(option) => `${option.value} · ${option.label}`}
                    placeholder={translate('chooseACurrency2')}
                    onChange={(code) => set('currency', code)}
                  />
                </FormField>
                {foreign && (
                  <>
                    <FormField
                      field="exchange_rate"
                      label={translate('per1', {
                        baseCurrency: baseCurrency,
                        currency: values.currency,
                      })}
                      error={errors.exchange_rate}
                      required
                      tip={translate('theRateYouBookWithTheESTVRateFor')}
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
                      <FormField field="exchange_rate_date" label={translate('rateDate')}>
                        <input
                          {...describe('exchange_rate_date')}
                          type="date"
                          value={values.exchange_rate_date}
                          onChange={(event) => set('exchange_rate_date', event.target.value)}
                          placeholder={translate('yyyyMMDD')}
                          className={cn(inputClass, 'cursor-text px-2 tabular-nums')}
                        />
                      </FormField>
                      <FormField field="exchange_rate_source" label={translate('source')}>
                        <Combobox
                          id={fieldId('exchange_rate_source')}
                          value={values.exchange_rate_source}
                          options={RATE_SOURCES.map((source) => ({
                            value: source.value,
                            label: source.label,
                          }))}
                          placeholder={translate('source')}
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

            <FormSection
              icon={Percent}
              title={translate('inputTax')}
              description={translate('howMuchOfTheVATYouCanReclaim')}
            >
              <FormField
                field="deductible_percent"
                label={translate('reclaimableVAT')}
                error={errors.deductible_percent}
                hint={isForeignVat(values.supplier_country) ? FOREIGN_VAT_HINT : undefined}
                tip={translate('inputTaxVorsteuerFullForBusinessCostsPartialFor')}
              >
                <div className="flex min-h-9 flex-wrap items-center gap-2">
                  <Segmented
                    label={translate('reclaimableVAT')}
                    value={values.input_tax}
                    options={[
                      { value: 'full', label: translate('full') },
                      { value: 'partial', label: translate('partial') },
                      { value: 'none', label: translate('none2') },
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
                        aria-label={translate('deductibleShareInPercent')}
                        className={cn(inputClass, 'w-20 text-right tabular-nums')}
                      />
                      %
                    </span>
                  )}
                </div>
              </FormField>
            </FormSection>

            {payment}

            <FormSection
              icon={StickyNote}
              title={translate('notes')}
              description={translate('forYourTeamAndYourAccountant')}
            >
              {note}
              <FormField
                field="receipt_missing_reason"
                label={translate('noReceipt')}
                tip={translate('aSubstituteReceiptErsatzbelegSayWhatWasBoughtWhere')}
              >
                <input
                  {...describe('receipt_missing_reason')}
                  value={values.receipt_missing_reason}
                  onChange={(event) => set('receipt_missing_reason', event.target.value)}
                  placeholder={translate('eGParkingMeterNoReceiptIssued')}
                  className={inputClass}
                />
              </FormField>
            </FormSection>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
        <span className="hidden text-xs text-muted-foreground sm:block">
          <kbd className="font-sans">⌘</kbd>
          {translate('enterToSave')}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto cursor-pointer"
          onClick={requestClose}
        >
          {translate('cancel')}
        </Button>
        {booked ? (
          <Button type="submit" disabled={busy} className="cursor-pointer">
            {busy ? translate('saving') : translate('saveChanges')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy || reading !== null}
              className="cursor-pointer"
              onClick={() => void submit(false)}
            >
              {translate('saveDraft')}
            </Button>
            <Button type="submit" disabled={busy || reading !== null} className="cursor-pointer">
              {busy ? translate('saving') : translate('saveAndBook')}
            </Button>
          </>
        )}
      </div>

      {discarding && (
        <ConfirmDialog
          title={translate('discardYourChanges')}
          body={translate('whatYouEnteredInThisFormWillBeLost')}
          confirmLabel={translate('discard')}
          cancelLabel={translate('keepEditing')}
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
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(fieldId(booked ? 'paid' : 'supplier_name'))?.focus()
        }}
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('expenseDetails')}</SheetDescription>
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
    { label: translate('net2'), value: formatMoney(expense.net_total, expense.currency) },
    ...expense.vat_breakdown
      .filter((group) => group.rate !== '0')
      .map((group) => ({
        label: translate('vatOn', {
          rate: group.rate,
          value2: formatMoney(group.taxable_amount, expense.currency),
        }),
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
        <span>{translate('total')}</span>
        <span className="tabular-nums">{formatMoney(expense.total, expense.currency)}</span>
      </div>
      {foreign && (
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>
            {translate('in2')}
            {expense.base.currency}
          </span>
          <span className="tabular-nums">
            {formatMoney(expense.base.total, expense.base.currency)}
          </span>
        </div>
      )}
      <div className="flex justify-between gap-4 text-success">
        <span>{translate('reclaimableInputTax2')}</span>
        <span className="tabular-nums">
          {formatMoney(expense.base.deductible_vat, expense.base.currency)}
        </span>
      </div>
    </div>
  )
}
