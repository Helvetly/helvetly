'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, ChevronsUpDown, FastForward, Hourglass, Plus, Repeat } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { FormChoiceCards, FormSection } from '@/components/form-section'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { ClientSearch } from '@/components/invoices/client-search'
import { ProductPicker } from '@/components/products/product-picker'
import { ApiError, errorMessage } from '@/lib/api'
import { useClient, type Client } from '@/lib/clients'
import {
  createEngagement,
  updateEngagement,
  type Engagement,
  type Recurrence,
} from '@/lib/engagements'
import { useHabits } from '@/lib/habits'
import {
  UNITS,
  useInvoiceSettings,
  VAT_CATEGORIES,
  VAT_RATES,
  type VatCategory,
} from '@/lib/invoices'
import { queryKeys } from '@/lib/queries'

import {
  ENGAGEMENT_HABIT_FIELDS,
  habitValues,
  newValues,
  FALLBACK_DEFAULTS,
  canRollOver,
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
    title: 'One-off',
    text: 'A fixed period, e.g. 30 h in 3 months.',
    icon: CalendarRange,
  },
  {
    value: 'recurring',
    title: 'Recurring',
    text: 'Repeats with the same quantity.',
    icon: Repeat,
  },
] as const

const BILLING_CHOICES = [
  {
    value: 'advance',
    title: 'Advance',
    text: 'Invoice the whole period upfront.',
    icon: FastForward,
  },
  {
    value: 'arrears',
    title: 'Arrears',
    text: 'Invoice what was delivered, afterwards.',
    icon: Hourglass,
  },
] as const

export function EngagementForm({
  open,
  onOpenChange,
  engagement,
  clientId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  engagement?: Engagement
  clientId?: string
  onSaved?: (engagement: Engagement) => void
}) {
  // Mounted only while open, so every opening starts from fresh values.
  if (!open) return null
  return (
    <FormSheet
      onClose={() => onOpenChange(false)}
      engagement={engagement}
      clientId={clientId}
      onSaved={onSaved}
    />
  )
}

type FormSheetProps = {
  onClose: () => void
  engagement?: Engagement
  clientId?: string
  onSaved?: (engagement: Engagement) => void
}

function FormSheet(props: FormSheetProps) {
  const settings = useInvoiceSettings()
  if (!props.engagement && !settled(settings))
    return <FormSheetLoading title="New engagement" onClose={props.onClose} />
  return <FormSheetBody {...props} />
}

function FormSheetBody({ onClose, engagement, clientId, onSaved }: FormSheetProps) {
  const settings = useInvoiceSettings().data
  const defaults = {
    currency: settings?.currency ?? FALLBACK_DEFAULTS.currency,
    vat_registered: settings?.vat_registered ?? FALLBACK_DEFAULTS.vat_registered,
    default_vat_rate: settings?.default_vat_rate ?? FALLBACK_DEFAULTS.default_vat_rate,
  }
  const { habits, remember } = useHabits()
  const [initial] = useState(() =>
    engagement ? valuesFromEngagement(engagement) : newValues(defaults, habits, clientId),
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [discarding, setDiscarding] = useState(false)
  const [clientOpen, setClientOpen] = useState(false)
  const [descriptionOpened, setDescriptionOpened] = useState(false)
  const [overageOpened, setOverageOpened] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const submitting = useRef(false)
  const pendingFocus = useRef<string | null>(null)
  const queryClient = useQueryClient()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const standard = values.vat_category === 'S'
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
      return (
        engagement ? await updateEngagement(engagement.id, input) : await createEngagement(input)
      ).data
    },
    onSuccess: (saved) => {
      if (!engagement)
        remember('engagement', habitValues(values), ENGAGEMENT_HABIT_FIELDS, values.client_id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.engagements })
      toast.success(engagement ? `${saved.title} saved.` : `${saved.title} created.`)
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
    const found = validate(values)
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
  const title = engagement ? `Edit ${engagement.title}` : 'New engagement'
  const unit = UNITS.find((u) => u.value === values.unit)
  const extra = `extra ${unit?.label.toLowerCase() ?? 'units'}`

  return (
    <Sheet open onOpenChange={(next) => !next && requestClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(1180px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">Engagement</SheetDescription>
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
              Work agreed with a client, tracked as it is delivered.
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            <div className="min-w-0 flex-1 lg:overflow-y-auto">
              <FormSection
                title="Client & service"
                description="Who it is for and what you deliver."
                action={
                  <ProductPicker
                    currency={values.currency}
                    vatMode="exclusive"
                    onPick={(_line, product) => setValues((v) => applyProduct(v, product))}
                  />
                }
              >
                <FormField field="client_id" label="Client" error={errors.client_id} required>
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
                          {clientName || (values.client_id ? 'Selected client' : 'Choose a client')}
                        </span>
                        <ChevronsUpDown className="size-4 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] p-0">
                      <ClientSearch selectedId={values.client_id || null} onSelect={pickClient} />
                    </PopoverContent>
                  </Popover>
                </FormField>
                <FormField field="title" label="Title" error={errors.title} required>
                  <input
                    {...describe('title')}
                    value={values.title}
                    onChange={(event) => set('title', event.target.value)}
                    placeholder="German lessons"
                    className={cn(inputClass, 'placeholder:text-placeholder')}
                  />
                </FormField>
                {showDescription ? (
                  <FormField
                    field="description"
                    label="Description"
                    error={errors.description}
                    tip="Internal notes; also added under the title on invoice lines."
                  >
                    <textarea
                      {...describe('description')}
                      rows={3}
                      value={values.description}
                      onChange={(event) => set('description', event.target.value)}
                      placeholder="Weekly German lessons for the sales team"
                      className={cn(inputClass, 'h-auto min-h-20 resize-y py-2')}
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
                    <Plus className="size-4" /> Add description
                  </Button>
                )}
              </FormSection>

              <FormSection title="Scope" description="How much you deliver in each period.">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-4">
                  <FormField
                    field="quantity"
                    label={recurring ? 'Quantity per period' : 'Quantity'}
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
                  <FormField field="unit" label="Unit">
                    <Combobox
                      id={fieldId('unit')}
                      value={values.unit}
                      options={UNIT_OPTIONS}
                      placeholder="No unit"
                      onChange={(code) =>
                        set('unit', UNITS.find((u) => u.value === code)?.value ?? '')
                      }
                    />
                  </FormField>
                </div>
              </FormSection>

              <FormSection
                title="Schedule"
                description="A fixed period, or one that repeats with the same quantity."
              >
                <FormChoiceCards
                  label="Schedule"
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
                {recurring && (
                  <FormField field="interval" label="Every" error={errors.interval} required>
                    <div className="flex gap-1.5 sm:max-w-xs">
                      <input
                        {...describe('interval')}
                        inputMode="numeric"
                        value={values.interval}
                        onChange={(event) => set('interval', event.target.value)}
                        className={cn(inputClass, 'w-16 shrink-0 text-right tabular-nums')}
                      />
                      <Combobox
                        id="engagement-recurrence"
                        label="Period"
                        value={values.recurrence}
                        options={[...RECURRENCE_OPTIONS]}
                        placeholder="Period"
                        onChange={(code) => {
                          const next = RECURRENCE_OPTIONS.find((o) => o.value === code)?.value
                          if (next) set('recurrence', next satisfies Recurrence)
                        }}
                      />
                    </div>
                  </FormField>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField field="start_date" label="Starts" error={errors.start_date} required>
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
                    label={recurring ? 'Ends (optional)' : 'Ends'}
                    error={errors.end_date}
                    required={!recurring}
                    hint={recurring ? 'Leave empty to run until you cancel it.' : undefined}
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
              </FormSection>

              <FormSection title="Price & VAT" description="When you invoice, and what you charge.">
                <FormChoiceCards
                  label="Billing"
                  value={values.billing}
                  options={[...BILLING_CHOICES]}
                  onChange={(billing) => set('billing', billing)}
                />
                <FormField
                  field="unit_price"
                  label={unit ? `Price per ${unit.short}` : 'Unit price'}
                  error={errors.unit_price ?? errors.currency}
                  tip="Net: VAT is added on top. Gross: VAT is included in the price."
                  required
                >
                  <div className="flex items-stretch gap-2">
                    <Combobox
                      id={fieldId('currency')}
                      label="Currency"
                      value={values.currency}
                      options={CURRENCY_OPTIONS}
                      renderValue={(option) => option.value}
                      placeholder="Currency"
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
                      label="Price basis"
                      value={values.price_basis}
                      options={[
                        { value: 'net', label: 'Net' },
                        { value: 'gross', label: 'Gross' },
                      ]}
                      onChange={(basis) => set('price_basis', basis)}
                    />
                  </div>
                </FormField>
                {showOverage ? (
                  <FormField
                    field="overage_unit_price"
                    label={`Price for ${extra}`}
                    error={errors.overage_unit_price}
                    tip="Charged for anything delivered beyond the committed quantity. Leave empty for the same price."
                  >
                    <input
                      {...describe('overage_unit_price')}
                      inputMode="decimal"
                      value={values.overage_unit_price}
                      onChange={(event) => set('overage_unit_price', event.target.value)}
                      placeholder="Same as the regular price"
                      className={cn(
                        inputClass,
                        'tabular-nums placeholder:text-placeholder sm:max-w-xs',
                      )}
                    />
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
                    <Plus className="size-4" /> Different price for {extra}
                  </Button>
                )}

                <FormField
                  field="vat_category"
                  label="VAT"
                  error={errors.vat_category ?? errors.vat_rate}
                  required
                >
                  <div className="flex items-stretch gap-2">
                    <Combobox
                      id={fieldId('vat_category')}
                      value={values.vat_category}
                      options={CATEGORY_OPTIONS}
                      placeholder="Choose a VAT category"
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
                        <div className="relative w-24 shrink-0">
                          <input
                            {...describe('vat_rate')}
                            aria-label="VAT rate"
                            aria-describedby={
                              errors.vat_rate ? `${fieldId('vat_category')}-error` : undefined
                            }
                            inputMode="decimal"
                            value={values.vat_rate}
                            onChange={(event) => set('vat_rate', event.target.value)}
                            className={cn(inputClass, 'pr-7 text-right tabular-nums')}
                          />
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                          >
                            %
                          </span>
                        </div>
                        <Segmented
                          label="VAT rate presets"
                          value={values.vat_rate}
                          options={VAT_RATES.map((rate) => ({ value: rate, label: rate }))}
                          onChange={(rate) => set('vat_rate', rate)}
                        />
                      </>
                    )}
                  </div>
                </FormField>
              </FormSection>

              <FormSection
                title="Details & automation"
                description="Optional. Nothing is sent or issued without you."
              >
                <div className="grid gap-2">
                  {canRollOver(values) && (
                    <SwitchRow
                      id="engagement-rollover"
                      label="Carry unused quantity to the next period"
                      description="What is left at the end of a period can be used in the next one only, then it expires."
                      checked={values.rollover}
                      onCheckedChange={(on) => set('rollover', on)}
                    />
                  )}
                  <SwitchRow
                    id="engagement-auto-invoice"
                    label="Create invoice drafts automatically"
                    description="Drafts only, you issue them: nothing is sent or issued without you."
                    checked={values.auto_invoice}
                    onCheckedChange={(on) => set('auto_invoice', on)}
                  />
                </div>

                <div className="grid gap-1.5">
                  <p className="text-[13px] font-medium">Usage on invoices</p>
                  <Segmented
                    label="Usage invoice lines"
                    value={values.invoice_detail}
                    options={[
                      { value: 'summary', label: 'One summary line' },
                      { value: 'per_entry', label: 'One line per entry' },
                    ]}
                    onChange={(detail) => set('invoice_detail', detail)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    field="reference"
                    label="Reference"
                    error={errors.reference}
                    tip="The client’s PO or order number; printed on every invoice."
                  >
                    <input
                      {...describe('reference')}
                      value={values.reference}
                      onChange={(event) => set('reference', event.target.value)}
                      placeholder="PO-2026-104"
                      className={inputClass}
                    />
                  </FormField>
                  <FormField
                    field="document_id"
                    label="Contract document"
                    error={errors.document_id}
                    tip="The ID of the signed contract in Documents."
                  >
                    <input
                      {...describe('document_id')}
                      value={values.document_id}
                      onChange={(event) => set('document_id', event.target.value)}
                      className={cn(inputClass, 'font-mono text-[13px]')}
                    />
                  </FormField>
                </div>
              </FormSection>
            </div>
            <EngagementSummary values={values} clientName={clientName} />
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
            <span className="hidden text-xs text-muted-foreground sm:block">
              <kbd className="font-sans">⌘</kbd> Enter to save
            </span>
            <Button type="button" variant="ghost" className="ml-auto" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : engagement ? 'Save changes' : 'Create engagement'}
            </Button>
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
      </SheetContent>
    </Sheet>
  )
}
