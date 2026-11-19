'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  CalendarRange,
  ChevronsUpDown,
  FastForward,
  Gauge,
  Handshake,
  Hourglass,
  Plus,
  Receipt,
  ReceiptText,
  Repeat,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { AIWrite } from '@/components/ai/ai-write'
import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { FormChoiceCards, FormSection } from '@/components/form-section'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { ClientSearch } from '@/components/invoices/client-search'
import { ProductPicker } from '@/components/products/product-picker'
import { PercentInput } from '@/components/shared/percent-input'
import { TextareaBox } from '@/components/textarea-box'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient, type Client } from '@/lib/clients'
import {
  createEngagement,
  linkInvoice,
  updateEngagement,
  type Engagement,
  type Recurrence,
} from '@/lib/engagements'
import { useHabits } from '@/lib/habits'
import { translate } from '@/lib/i18n'
import {
  UNITS,
  useInvoiceSettings,
  VAT_CATEGORIES,
  VAT_RATES,
  type VatCategory,
} from '@/lib/invoices'
import { useCan } from '@/lib/permissions'
import { queryKeys } from '@/lib/queries'

import { ContractDocumentField } from './contract-document-field'
import {
  ENGAGEMENT_HABIT_FIELDS,
  habitValues,
  newValues,
  FALLBACK_DEFAULTS,
  canRollOver,
  DESCRIPTION_MAX,
  keptLongDescription,
  FIELD_ORDER,
  RECURRENCE_OPTIONS,
  serverFieldErrors,
  toInput,
  validate,
  valuesFromEngagement,
  applyProduct,
  withClientHabits,
  type FieldErrors,
  type FormValues,
} from './engagement-form-model'
import { EngagementSummary } from './engagement-summary'
import { InvoiceLinkField } from './invoice-link-field'

const fieldId = (field: keyof FormValues) => `engagement-${field}`

function FormField({
  field,
  ...props
}: Omit<ComponentProps<typeof SharedField>, 'id'> & { field: keyof FormValues }) {
  return <SharedField id={fieldId(field)} {...props} />
}

const UNIT_OPTIONS = UNITS.map((unit) => ({
  value: unit.value,
  label: unit.label,
  hint: unit.short,
}))
const CATEGORY_OPTIONS = VAT_CATEGORIES.map((c) => ({
  value: c.value,
  label: c.label,
  hint: c.value,
}))

const SCHEDULE_CHOICES = [
  {
    value: 'once',
    title: translate('oneOff'),
    text: translate('aFixedPeriodEG30HIn3'),
    icon: CalendarRange,
  },
  {
    value: 'recurring',
    title: translate('recurring'),
    text: translate('repeatsWithTheSameQuantity'),
    icon: Repeat,
  },
] as const

const BILLING_CHOICES = [
  {
    value: 'paid',
    title: translate('paidSeparately'),
    text: translate('paidSeparatelyText'),
    icon: ReceiptText,
  },
  {
    value: 'advance',
    title: translate('advance'),
    text: translate('invoiceTheWholePeriodUpfront'),
    icon: FastForward,
  },
  {
    value: 'arrears',
    title: translate('arrears'),
    text: translate('invoiceWhatWasDeliveredAfterwards'),
    icon: Hourglass,
  },
] as const

export function EngagementForm({
  open,
  onOpenChange,
  engagement,
  clientId,
  title,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  engagement?: Engagement
  clientId?: string
  /** A new engagement's title, e.g. what was typed into a picker. */
  title?: string
  onSaved?: (engagement: Engagement) => void
}) {
  // Mounted only while open, so every opening starts from fresh values.
  if (!open) return null
  return (
    <FormSheet
      onClose={() => onOpenChange(false)}
      engagement={engagement}
      clientId={clientId}
      title={title}
      onSaved={onSaved}
    />
  )
}

type FormSheetProps = {
  onClose: () => void
  engagement?: Engagement
  clientId?: string
  title?: string
  onSaved?: (engagement: Engagement) => void
}

function FormSheet(props: FormSheetProps) {
  const settings = useInvoiceSettings()
  if (!props.engagement && !settled(settings))
    return <FormSheetLoading title={translate('newEngagement2')} onClose={props.onClose} />
  return <FormSheetBody {...props} />
}

function FormSheetBody({
  onClose,
  engagement,
  clientId,
  title: newTitle,
  onSaved,
}: FormSheetProps) {
  const settings = useInvoiceSettings().data
  const defaults = {
    currency: settings?.currency ?? FALLBACK_DEFAULTS.currency,
    vat_registered: settings?.vat_registered ?? FALLBACK_DEFAULTS.vat_registered,
    default_vat_rate: settings?.default_vat_rate ?? FALLBACK_DEFAULTS.default_vat_rate,
  }
  const { habits, remember } = useHabits()
  const [initial] = useState(() =>
    engagement
      ? valuesFromEngagement(engagement)
      : { ...newValues(defaults, habits, clientId), ...(newTitle ? { title: newTitle } : {}) },
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [discarding, setDiscarding] = useState(false)
  const [clientOpen, setClientOpen] = useState(false)
  const [invoiceId, setInvoiceId] = useState('')
  const canLinkInvoice = useCan('write:invoices')
  const [descriptionOpened, setDescriptionOpened] = useState(false)
  const [overageOpened, setOverageOpened] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const submitting = useRef(false)
  const pendingFocus = useRef<string | null>(null)
  const queryClient = useQueryClient()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const standard = values.vat_category === 'S'
  const paid = values.billing === 'paid'
  const recurring = values.recurrence !== 'none'
  const showDescription =
    descriptionOpened || Boolean(values.description) || Boolean(errors.description)
  const showOverage =
    overageOpened || Boolean(values.overage_unit_price) || Boolean(errors.overage_unit_price)

  // A client passed in by id (from the client page) still needs its name shown.
  const preset = useClient(clientId && !engagement ? clientId : null)
  const clientName = values.client_name || preset.data?.name || ''

  const save = useMutation({
    mutationFn: async () => {
      const input = toInput(values)
      const saved = (
        engagement ? await updateEngagement(engagement.id, input) : await createEngagement(input)
      ).data
      // The engagement exists now: a refused link is reported, it does not undo the save.
      if (!engagement && invoiceId)
        await linkInvoice(saved.id, invoiceId).catch((error: unknown) =>
          toast.error(translate('invoiceNotLinked', { message: errorMessage(error) })),
        )
      return saved
    },
    onSuccess: (saved) => {
      if (!engagement)
        remember('engagement', habitValues(values), ENGAGEMENT_HABIT_FIELDS, values.client_id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.engagements })
      toast.success(
        engagement
          ? translate('saved2', { title: saved.title })
          : translate('created4', { title: saved.title }),
      )
      onSaved?.(saved)
      onClose()
    },
    onError: (error) => {
      submitting.current = false
      const fromServer =
        error instanceof ApiError && error.status === 422 ? serverFieldErrors(error.details) : {}
      if (Object.keys(fromServer).length) {
        setErrors(fromServer)
        focusFirstError(fromServer)
      } else toast.error(errorMessage(error))
    },
  })

  // Focus waits for the render, so a field revealed by its own error can be focused too.
  useEffect(() => {
    if (!pendingFocus.current) return
    document.getElementById(pendingFocus.current)?.focus()
    pendingFocus.current = null
  })

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
      )
  }

  function focusFirstError(found: FieldErrors) {
    const first = FIELD_ORDER.find((field) => found[field])
    if (first) pendingFocus.current = fieldId(first)
  }

  const submit = () => {
    if (submitting.current) return
    const found = validate(values, initial.description)
    setErrors(found)
    if (Object.keys(found).length) return focusFirstError(found)
    submitting.current = true
    save.mutate()
  }

  // ⌘Enter / Ctrl+Enter saves from anywhere in the form.
  const saveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    if (!(event.target instanceof Node) || !form.current?.contains(event.target)) return
    event.preventDefault()
    submit()
  })
  useEffect(() => {
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [])

  const pickClient = (client: Client) => {
    if (client.id !== values.client_id) setInvoiceId('')
    setValues((v) => ({
      ...(engagement ? v : withClientHabits(v, initial, defaults, habits, client.id)),
      client_id: client.id,
      client_name: client.name,
      currency: !engagement && !v.product_id && client.currency ? client.currency : v.currency,
    }))
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'client_id')),
    )
    setClientOpen(false)
  }

  // Closing mid-save would drop the answer: React Query skips a call's callbacks after unmount, so a
  // refusal (or the success toast) never shows and the typed data is gone.
  const requestClose = () => {
    if (save.isPending) return
    if (dirty) setDiscarding(true)
    else onClose()
  }
  const describe = (field: keyof FormValues) => ({
    id: fieldId(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined,
  })
  const title = engagement
    ? translate('edit5', { title: engagement.title })
    : translate('newEngagement2')
  const unit = UNITS.find((u) => u.value === values.unit)
  const extra = translate('dynamicExtra', {
    value1: unit?.label.toLowerCase() ?? translate('dynamicUnits'),
  })

  return (
    <Sheet open onOpenChange={(next) => !next && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(1180px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('engagement2')}</SheetDescription>
        <form
          ref={form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-col gap-0.5 border-b px-5 py-4 md:px-8">
            <h2 className="truncate text-lg font-semibold">{title}</h2>
            <p className="text-[13px] text-muted-foreground">
              {translate('workAgreedWithAClientTrackedAsItIs')}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            <div className="min-w-0 flex-1 lg:overflow-y-auto">
              <FormSection
                icon={Handshake}
                title={translate('clientService')}
                description={translate('whoItIsForAndWhatYouDeliver')}
                action={
                  <ProductPicker
                    currency={values.currency}
                    vatMode="exclusive"
                    onPick={(_line, product) => setValues((v) => applyProduct(v, product))}
                  />
                }
              >
                <FormField
                  field="client_id"
                  label={translate('client')}
                  error={errors.client_id}
                  required
                >
                  <Popover open={clientOpen} onOpenChange={setClientOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        {...describe('client_id')}
                        className={cn(inputClass, 'flex items-center justify-between text-left')}
                      >
                        <span
                          className={cn('truncate', !values.client_id && 'text-muted-foreground')}
                        >
                          {clientName ||
                            (values.client_id
                              ? translate('selectedClient')
                              : translate('chooseAClient'))}
                        </span>
                        <ChevronsUpDown className="size-4 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] p-0">
                      <ClientSearch selectedId={values.client_id || null} onSelect={pickClient} />
                    </PopoverContent>
                  </Popover>
                </FormField>
                <FormField field="title" label={translate('title')} error={errors.title} required>
                  <input
                    {...describe('title')}
                    value={values.title}
                    onChange={(event) => set('title', event.target.value)}
                    placeholder={translate('germanLessons')}
                    className={cn(inputClass, 'placeholder:text-placeholder')}
                  />
                </FormField>
                {showDescription ? (
                  <FormField
                    field="description"
                    label={translate('description')}
                    error={errors.description}
                    hint={
                      keptLongDescription(values.description, initial.description)
                        ? translate('descriptionKeptLong', { max: DESCRIPTION_MAX })
                        : undefined
                    }
                    tip={translate('internalNotesAlsoAddedUnderTheTitleOnInvoice')}
                  >
                    <TextareaBox
                      {...describe('description')}
                      rows={3}
                      value={values.description}
                      onChange={(event) => set('description', event.target.value)}
                      placeholder={translate('weeklyGermanLessonsForTheSalesTeam')}
                      max={DESCRIPTION_MAX}
                      tools={
                        <AIWrite
                          field="engagement_description"
                          text={values.description}
                          maxLength={1000}
                          context={{
                            title: values.title,
                            client: clientName,
                            quantity:
                              values.quantity &&
                              `${values.quantity} ${unit?.label ?? values.unit ?? ''}`,
                            price: values.unit_price && `${values.currency} ${values.unit_price}`,
                            repeats: values.recurrence,
                          }}
                          onApply={(text) => set('description', text)}
                        />
                      }
                    />
                  </FormField>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-mt-1 w-fit cursor-pointer gap-1.5 px-2 text-muted-foreground"
                    onClick={() => {
                      pendingFocus.current = fieldId('description')
                      setDescriptionOpened(true)
                    }}
                  >
                    <Plus className="size-4" />
                    {translate('addDescription')}
                  </Button>
                )}
              </FormSection>

              <FormSection
                icon={Gauge}
                title={translate('scope')}
                description={translate('howMuchYouDeliverInEachPeriod')}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-4">
                  <FormField
                    field="quantity"
                    label={recurring ? translate('quantityPerPeriod') : translate('quantity')}
                    error={errors.quantity}
                    required
                  >
                    <input
                      {...describe('quantity')}
                      inputMode="decimal"
                      value={values.quantity}
                      onChange={(event) => set('quantity', event.target.value)}
                      placeholder="30"
                      className={cn(inputClass, 'tabular-nums placeholder:text-placeholder')}
                    />
                  </FormField>
                  <FormField field="unit" label={translate('unit')}>
                    <Combobox
                      id={fieldId('unit')}
                      value={values.unit}
                      options={UNIT_OPTIONS}
                      placeholder={translate('noUnit')}
                      onChange={(code) =>
                        set('unit', UNITS.find((u) => u.value === code)?.value ?? '')
                      }
                    />
                  </FormField>
                </div>
              </FormSection>

              <FormSection
                icon={CalendarDays}
                title={translate('schedule')}
                description={translate('aFixedPeriodOrOneThatRepeatsWithThe')}
              >
                <FormChoiceCards
                  label={translate('schedule')}
                  value={recurring ? 'recurring' : 'once'}
                  options={[...SCHEDULE_CHOICES]}
                  onChange={(kind) =>
                    setValues((v) => ({
                      ...v,
                      recurrence:
                        kind === 'once'
                          ? 'none'
                          : v.recurrence === 'none'
                            ? 'monthly'
                            : v.recurrence,
                      end_date: kind === 'once' ? '' : v.end_date,
                    }))
                  }
                />
                {/* Every | Starts | Ends on one row where the dates still fit, else Every on a row of its own. */}
                <div className="@container">
                  <div
                    className={cn(
                      'grid gap-4 @sm:grid-cols-2',
                      recurring &&
                        '@md:grid-cols-[minmax(10.5rem,1fr)_minmax(0,1fr)_minmax(0,1fr)]',
                    )}
                  >
                    {recurring && (
                      <FormField
                        field="interval"
                        className="@sm:col-span-2 @md:col-span-1"
                        label={translate('every')}
                        error={errors.interval}
                        required
                      >
                        <div className="flex gap-1.5">
                          <input
                            {...describe('interval')}
                            inputMode="numeric"
                            value={values.interval}
                            onChange={(event) => set('interval', event.target.value)}
                            className={cn(inputClass, 'w-12 shrink-0 text-right tabular-nums')}
                          />
                          <Combobox
                            id="engagement-recurrence"
                            label={translate('period')}
                            value={values.recurrence}
                            options={[...RECURRENCE_OPTIONS]}
                            placeholder={translate('period')}
                            className="min-w-0 flex-1"
                            onChange={(code) => {
                              const next = RECURRENCE_OPTIONS.find((o) => o.value === code)?.value
                              if (next) set('recurrence', next satisfies Recurrence)
                            }}
                          />
                        </div>
                      </FormField>
                    )}
                    <FormField
                      field="start_date"
                      label={translate('starts')}
                      error={errors.start_date}
                      required
                    >
                      <input
                        {...describe('start_date')}
                        type="date"
                        value={values.start_date}
                        onChange={(event) => set('start_date', event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                    <FormField
                      field="end_date"
                      label={recurring ? translate('endsOptional') : translate('ends')}
                      error={errors.end_date}
                      required={!recurring}
                      hint={recurring ? translate('leaveEmptyToRunUntilYouCancelIt') : undefined}
                    >
                      <input
                        {...describe('end_date')}
                        type="date"
                        value={values.end_date}
                        onChange={(event) => set('end_date', event.target.value)}
                        className={inputClass}
                      />
                    </FormField>
                  </div>
                </div>
              </FormSection>

              <FormSection
                icon={Receipt}
                title={translate('invoicing')}
                description={translate('invoicingSectionText')}
              >
                <FormChoiceCards
                  label={translate('billing')}
                  value={values.billing}
                  options={[...BILLING_CHOICES]}
                  onChange={(billing) => set('billing', billing)}
                />
                {!engagement &&
                  values.client_id &&
                  canLinkInvoice &&
                  values.billing !== 'arrears' && (
                    <SharedField
                      id="engagement-invoice"
                      label={paid ? translate('paidWithInvoice') : translate('alreadyInvoiced')}
                      tip={translate('alreadyInvoicedTip')}
                    >
                      <InvoiceLinkField
                        id="engagement-invoice"
                        clientId={values.client_id}
                        value={invoiceId}
                        onChange={setInvoiceId}
                      />
                    </SharedField>
                  )}
                {!paid && (
                  <>
                    <FormField
                      field="unit_price"
                      label={
                        unit ? translate('pricePer', { short: unit.short }) : translate('unitPrice')
                      }
                      error={errors.unit_price ?? errors.currency}
                      tip={translate('netVATIsAddedOnTopGrossVATIs')}
                      required
                    >
                      <div className="flex items-stretch gap-2">
                        <Combobox
                          id={fieldId('currency')}
                          label={translate('currency')}
                          value={values.currency}
                          options={CURRENCY_OPTIONS}
                          renderValue={(option) => option.value}
                          placeholder={translate('currency')}
                          invalid={Boolean(errors.currency)}
                          className="w-24 shrink-0"
                          onChange={(code) => set('currency', code)}
                        />
                        <input
                          {...describe('unit_price')}
                          inputMode="decimal"
                          value={values.unit_price}
                          onChange={(event) => set('unit_price', event.target.value)}
                          placeholder="0.00"
                          className={cn(inputClass, 'tabular-nums placeholder:text-placeholder')}
                        />
                        <Segmented
                          label={translate('priceBasis')}
                          value={values.price_basis}
                          options={[
                            { value: 'net', label: translate('net2') },
                            { value: 'gross', label: translate('gross') },
                          ]}
                          onChange={(basis) => set('price_basis', basis)}
                        />
                      </div>
                    </FormField>
                    {showOverage ? (
                      <FormField
                        field="overage_unit_price"
                        label={translate('priceFor', { extra: extra })}
                        error={errors.overage_unit_price}
                        tip={translate(
                          'chargedForAnythingDeliveredBeyondTheCommittedQuantityLeave',
                        )}
                      >
                        {/* Follows the regular price's currency and basis, so both show as fixed adornments. */}
                        <div className="relative sm:max-w-xs">
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
                          >
                            {values.currency}
                          </span>
                          <input
                            {...describe('overage_unit_price')}
                            inputMode="decimal"
                            value={values.overage_unit_price}
                            onChange={(event) => set('overage_unit_price', event.target.value)}
                            placeholder={translate('sameAsTheRegularPrice')}
                            className={cn(
                              inputClass,
                              'pr-16 pl-13 tabular-nums placeholder:text-placeholder',
                            )}
                          />
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                          >
                            {values.price_basis === 'gross'
                              ? translate('gross')
                              : translate('net2')}
                          </span>
                        </div>
                      </FormField>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-mt-1 w-fit cursor-pointer gap-1.5 px-2 text-muted-foreground"
                        onClick={() => {
                          pendingFocus.current = fieldId('overage_unit_price')
                          setOverageOpened(true)
                        }}
                      >
                        <Plus className="size-4" />
                        {translate('differentPriceFor')}
                        {extra}
                      </Button>
                    )}

                    <FormField
                      field="vat_category"
                      label={translate('vat')}
                      error={errors.vat_category ?? errors.vat_rate}
                      required
                    >
                      <div className="flex items-stretch gap-2">
                        <Combobox
                          id={fieldId('vat_category')}
                          value={values.vat_category}
                          options={CATEGORY_OPTIONS}
                          placeholder={translate('chooseAVATCategory')}
                          className="min-w-0 flex-1 shrink"
                          onChange={(code) => {
                            const category = VAT_CATEGORIES.find((c) => c.value === code)?.value
                            if (!category) return
                            set('vat_category', category satisfies VatCategory)
                            if (category !== 'S') set('vat_rate', '0')
                            else if (!standard) set('vat_rate', VAT_RATES[0])
                          }}
                        />
                        {standard && (
                          <>
                            <PercentInput
                              {...describe('vat_rate')}
                              aria-label={translate('vatRate')}
                              aria-describedby={
                                errors.vat_rate ? `${fieldId('vat_category')}-error` : undefined
                              }
                              value={values.vat_rate}
                              onValueChange={(value) => set('vat_rate', value)}
                              className="w-24 shrink-0"
                              inputClassName={cn(inputClass, 'text-right tabular-nums')}
                            />
                            <Segmented
                              label={translate('vatRatePresets')}
                              value={values.vat_rate}
                              options={VAT_RATES.map((rate) => ({ value: rate, label: rate }))}
                              onChange={(rate) => set('vat_rate', rate)}
                            />
                          </>
                        )}
                      </div>
                    </FormField>
                  </>
                )}
                <div className="grid gap-2">
                  {canRollOver(values) && (
                    <SwitchRow
                      id="engagement-rollover"
                      label={translate('carryUnusedQuantityToTheNextPeriod')}
                      description={translate('whatIsLeftAtTheEndOfAPeriod')}
                      checked={values.rollover}
                      onCheckedChange={(on) => set('rollover', on)}
                    />
                  )}
                  {!paid && (
                    <SwitchRow
                      id="engagement-auto-invoice"
                      label={translate('createInvoiceDraftsAutomatically')}
                      description={translate('draftsOnlyYouIssueThemNothingIsSentOr')}
                      checked={values.auto_invoice}
                      onCheckedChange={(on) => set('auto_invoice', on)}
                    />
                  )}
                </div>

                {!paid && (
                  <div className="grid gap-1.5">
                    <p className="text-[13px] font-medium">{translate('usageOnInvoices')}</p>
                    <Segmented
                      label={translate('usageInvoiceLines')}
                      value={values.invoice_detail}
                      options={[
                        { value: 'summary', label: translate('oneSummaryLine') },
                        { value: 'per_entry', label: translate('oneLinePerEntry') },
                      ]}
                      onChange={(detail) => set('invoice_detail', detail)}
                    />
                  </div>
                )}
              </FormSection>

              <FormSection
                icon={SlidersHorizontal}
                title={translate('details')}
                description={translate('detailsSectionText')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    field="reference"
                    label={translate('reference')}
                    error={errors.reference}
                    tip={translate('theClientSPOOrOrderNumberPrintedOn')}
                  >
                    <input
                      {...describe('reference')}
                      value={values.reference}
                      onChange={(event) => set('reference', event.target.value)}
                      placeholder={translate('po2026104')}
                      className={inputClass}
                    />
                  </FormField>
                  <FormField
                    field="document_id"
                    label={translate('contractDocument')}
                    error={errors.document_id}
                    tip={translate('contractDocumentTip')}
                  >
                    <ContractDocumentField
                      id={fieldId('document_id')}
                      value={values.document_id}
                      clientId={values.client_id}
                      invalid={Boolean(errors.document_id)}
                      onChange={(id) => set('document_id', id)}
                    />
                  </FormField>
                </div>
              </FormSection>
            </div>
            <EngagementSummary values={values} clientName={clientName} />
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Kbd>⌘ Enter</Kbd>
              {translate('toSave')}
            </span>
            <Button type="button" variant="ghost" className="ml-auto" onClick={requestClose}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? translate('saving')
                : engagement
                  ? translate('saveChanges')
                  : translate('createEngagement')}
            </Button>
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
      </SheetContent>
    </Sheet>
  )
}
