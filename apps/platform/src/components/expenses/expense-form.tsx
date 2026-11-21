'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  Calculator,
  CreditCard,
  FileText,
  Lock,
  Paperclip,
  Percent,
  StickyNote,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { isAIConsentRequired, useAIApproval } from '@/components/ai/ai-approval'
import { promptUpgrade, toastError } from '@/components/billing/upgrade-prompt'
import {
  Combobox,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  inputClass,
} from '@/components/clients/fields'
import { ExpenseCategoryField } from '@/components/expenses/expense-category-field'
import { FormSection } from '@/components/form-section'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { PercentInput } from '@/components/shared/percent-input'
import { SwissScopeNotice } from '@/components/swiss-scope-notice'
import { TextareaBox } from '@/components/textarea-box'
import { ApiError, errorMessage } from '@/lib/api'
import { treatmentRate } from '@/lib/expense-categories'
import {
  expensesApi,
  canRecognize,
  FOREIGN_VAT_HINT,
  isForeignVat,
  isHeic,
  RATE_SOURCES,
  receiptsChanged,
  recognizeReceipt,
  refreshExpenses,
  uploadReceipts,
  useExpenseCategories,
  useExpensePreview,
  useSaveExpense,
  type Expense,
} from '@/lib/expenses'
import { preferred, useHabits } from '@/lib/habits'
import { usageKey } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { PAYMENT_METHODS, today as workspaceToday, useInvoiceSettings } from '@/lib/invoices'
import { useSession } from '@/lib/queries'

import { DuplicateWarning } from './duplicate-warning'
import { ExpenseLines, ExpenseTotals } from './expense-amounts'
import {
  EXPENSE_HABITS,
  newValues,
  firstError,
  NOTE_MAX,
  serverFieldErrors,
  toInput,
  validate,
  valuesFromExpense,
  withCategoryRate,
  withSupplierCountry,
  type FieldErrors,
  type FormValues,
} from './expense-form-model'
import { applyRecognition, type Applied } from './expense-form-recognition'
import { readFailure, ReadFailureAlert, type ReadFailure } from './expense-read-failure'
import { ReceiptDrop, StagedReceipts } from './expense-receipts'
import { recognizedLabel } from './expense-reread-model'
import { ExpenseReading, ExpenseStart, READ_MAX_PAGES, useReceiptAIBlock } from './expense-start'

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

const NO_FILES: File[] = []

/** Beside a field the reading filled: the sparkle, or an amber dot when it was read with low confidence. */
function AIMark({ unsure }: { unsure: boolean }) {
  const label = unsure ? translate('aiReadCheckIt') : translate('aiFilledFromReceipt')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-ai-mark={unsure ? 'unsure' : 'sure'} className="inline-flex">
          {unsure ? (
            <span aria-hidden className="m-1 size-2 rounded-full bg-warning-solid" />
          ) : (
            <HeidiSparkle className="size-3.5" />
          )}
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">{label}</TooltipContent>
    </Tooltip>
  )
}

/** What the last reading did, for the review note under the receipt and the marks beside the fields. */
type Recognized =
  | (Pick<Applied, 'applied' | 'kept' | 'uncertain'> & {
      issues: string[]
      categoryConfidence: number | null
    })
  | { failure: ReadFailure }

type ExpenseFormProps = {
  expense?: Expense
  /** Receipts dropped before the form opened (a new expense only). */
  initialFiles?: File[]
  /** A new expense starts with its receipt (ExpenseStart) in this same sheet. */
  start?: boolean
  /** "One expense per file": hands the files to the AI import. */
  onImport?: (files: File[]) => void
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

function ExpenseFormBody({
  expense,
  initialFiles = NO_FILES,
  start = false,
  onImport,
  onClose,
  onSaved,
}: ExpenseFormProps) {
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
  // One sheet: the receipt first (a new expense), the reading, then the form.
  const [step, setStep] = useState<'start' | 'reading' | 'form'>(
    start && !expense ? 'start' : 'form',
  )
  const aiBlock = useReceiptAIBlock()
  // Receipt reading: the staged files as one receipt's pages, one request at a time; `touched` is every field the
  // person ever edited.
  const touched = useRef(new Set<string>())
  const [reading, setReading] = useState<File[] | null>(null)
  const [recognized, setRecognized] = useState<Recognized | null>(null)
  const reader = useRef<AbortController | null>(null)
  const { ensure } = useAIApproval()
  const queryClient = useQueryClient()
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
  const readable = staged.filter(canRecognize).slice(0, READ_MAX_PAGES)
  const stopReading = () => {
    reader.current?.abort()
    reader.current = null
    setReading(null)
    setRecognized(null)
    setStep('form')
  }
  const recognize = async (files: File[]) => {
    if (reader.current || expense || !files.length) return // recognition fills a new expense only
    const controller = new AbortController()
    const startedIn = workspaceId
    reader.current = controller
    setReading(files)
    setRecognized(null)
    // Removed, replaced, closed or another workspace meanwhile (also while the approval question was open).
    const stale = () =>
      controller.signal.aborted ||
      reader.current !== controller ||
      currentWorkspace.current !== startedIn
    try {
      // The shared first-use approval: "Not now" sends nothing and keeps the form and the files.
      if (!(await ensure())) {
        if (!stale())
          setRecognized({
            failure: {
              tone: 'warning',
              title: translate('readNotSentTitle'),
              body: translate('receiptNotReadNoApproval'),
            },
          })
        return
      }
      if (stale()) return
      let suggestions
      try {
        suggestions = await recognizeReceipt(files, crypto.randomUUID(), controller.signal)
      } catch (error) {
        // The server still wanted approval (withdrawn elsewhere, a new notice since): ask once and retry once.
        if (!isAIConsentRequired(error) || stale()) throw error
        await queryClient.invalidateQueries({ queryKey: usageKey })
        if (!(await ensure()) || stale()) throw error
        suggestions = await recognizeReceipt(files, crypto.randomUUID(), controller.signal)
      }
      if (stale()) return
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
        uncertain: result.uncertain,
        issues: Object.values(suggestions.issues),
        categoryConfidence: suggestions.category?.confidence ?? null,
      })
    } catch (error) {
      if (controller.signal.aborted || reader.current !== controller) return
      if (!promptUpgrade(error)) setRecognized({ failure: readFailure(error) })
    } finally {
      if (reader.current === controller) {
        reader.current = null
        setReading(null)
        setStep('form')
      }
    }
  }
  const categoryRate = (id: string) =>
    treatmentRate(
      categories.data?.find((category) => category.id === id)?.vat_treatment,
      values.document_date,
    )
  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    touched.current.add(field)
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
      )
  }
  const setAmounts = (change: Partial<Pick<FormValues, 'lines' | 'entry_mode'>>) => {
    touched.current.add('lines')
    setValues((current) => ({ ...current, ...change }))
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith('lines'))),
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
        receiptsChanged(queryClient, saved.id)
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
          refreshExpenses(queryClient, saved)
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
      // The expense as it now is (receipts, booking), so its drawer opens on it and not on the first save.
      refreshExpenses(queryClient, saved)
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
  const filled = recognized && 'applied' in recognized ? recognized : null
  const mark = (field: string) =>
    filled?.applied.includes(field) ? (
      <AIMark unsure={filled.uncertain.includes(field)} />
    ) : undefined
  const describe = (field: string) => ({
    id: fieldId(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined,
  })
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
      hint={translate('onlyYourTeamSeesThis')}
    >
      <TextareaBox
        {...describe('note')}
        rows={2}
        value={values.note}
        onChange={(event) => set('note', event.target.value)}
        placeholder={translate('anythingYourTeamOrYourAccountantShouldKnow')}
        max={NOTE_MAX}
        className="min-h-14"
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
                        if (reading?.includes(file)) stopReading()
                        setStaged(staged.filter((entry) => entry !== file))
                      }}
                    />
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Button
                          type="button"
                          variant="ai"
                          size="sm"
                          disabled={!readable.length || reading !== null || aiBlock !== null}
                          title={aiBlock ?? undefined}
                          className="cursor-pointer"
                          onClick={() => void recognize(readable)}
                        >
                          <HeidiSparkle />
                          {reading
                            ? translate('readingTheReceipt')
                            : recognized
                              ? translate('readAgainWithAI')
                              : translate('readWithAI')}
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          {aiBlock ?? translate('recognizeReceiptNotice')}
                        </span>
                      </div>
                      {staged.some(isHeic) && (
                        <p className="text-xs text-muted-foreground">
                          {translate('heicCantBeRead')}
                        </p>
                      )}
                      {recognized && 'failure' in recognized && (
                        <ReadFailureAlert failure={recognized.failure} />
                      )}
                      <output
                        aria-live="polite"
                        className="grid gap-1 text-xs text-muted-foreground empty:hidden"
                      >
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
                            {recognized.uncertain.length > 0 && (
                              <span>
                                {translate('checkUnsureFromTheReceipt', {
                                  fields: recognized.uncertain.map(recognizedLabel).join(', '),
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
                  mark={mark('supplier_name')}
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
                  mark={mark('document_date')}
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
                  mark={mark('due_date')}
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
                  mark={mark('category_id')}
                  label={translate('category')}
                  error={errors.category_id}
                  required
                  tip={translate('eachCategoryBooksToAnAccountOfTheSwiss')}
                  status={
                    filled?.applied.includes('category_id') &&
                    filled.categoryConfidence !== null && (
                      <span className="text-xs text-muted-foreground">
                        {translate('aiCategoryConfidence', {
                          percent: Math.round(filled.categoryConfidence * 100),
                        })}
                      </span>
                    )
                  }
                >
                  <ExpenseCategoryField
                    id={fieldId('category_id')}
                    value={values.category_id}
                    invalid={Boolean(errors.category_id)}
                    onChange={(id) => {
                      const from = registered
                        ? (categoryRate(values.category_id) ?? defaultRate)
                        : null
                      set('category_id', id)
                      setValues((current) => withCategoryRate(current, from, categoryRate(id)))
                    }}
                  />
                </FormField>
                <FormField
                  field="reference"
                  mark={mark('reference')}
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
                  mark={mark('supplier_country')}
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
                  mark={mark('supplier_vat_number')}
                  label={translate('supplierVATUID')}
                  error={errors.supplier_vat_number}
                  tip={translate('printedOnTheReceiptEGCHE123456')}
                >
                  <input
                    {...describe('supplier_vat_number')}
                    value={values.supplier_vat_number}
                    onChange={(event) => set('supplier_vat_number', event.target.value)}
                    placeholder={translate('che123456789MWST')}
                    className={cn(inputClass, 'font-code text-[13px]')}
                  />
                </FormField>
                <FormField
                  field="description"
                  mark={mark('description')}
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
              <ExpenseLines
                values={values}
                errors={errors}
                newRate={registered ? defaultRate : '0'}
                describe={describe}
                onValues={setAmounts}
                onLine={setLine}
              />

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

              <ExpenseTotals expense={totals} foreign={foreign} loading={preview.isFetching} />
            </FormSection>

            <FormSection
              icon={Percent}
              title={translate('inputTax')}
              description={translate('howMuchOfTheVATYouCanReclaim')}
            >
              <SwissScopeNotice area="expenses" />
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
                    <PercentInput
                      {...describe('deductible_percent')}
                      value={values.deductible_percent}
                      onValueChange={(value) => set('deductible_percent', value)}
                      placeholder="50"
                      aria-label={translate('deductibleShareInPercent')}
                      className="w-24"
                      inputClassName={cn(inputClass, 'text-right tabular-nums')}
                    />
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
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Kbd>⌘ Enter</Kbd>
          {translate('toSave')}
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
        className={cn(
          // The width follows the step at the sheet's own pace: a shorter duration would cut its slide out short.
          'w-full! max-w-none! gap-0 p-0 transition-[width] dark:bg-card',
          step === 'form'
            ? 'sm:w-[min(900px,calc(100vw-6rem))]!'
            : 'sm:w-[min(600px,calc(100vw-6rem))]!',
        )}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('expenseDetails')}</SheetDescription>
        {step === 'start' ? (
          <ExpenseStart
            onRead={(files) => {
              setStaged(files)
              setStep('reading')
              void recognize(files)
            }}
            onContinue={(files) => {
              setStaged(files)
              setStep('form')
            }}
            onImport={(files) => onImport?.(files)}
            onCancel={onClose}
          />
        ) : step === 'reading' ? (
          <ExpenseReading files={reading ?? staged} onStop={stopReading} />
        ) : (
          body
        )}
      </SheetContent>
    </Sheet>
  )
}
