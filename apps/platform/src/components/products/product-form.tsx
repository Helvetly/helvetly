'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { cn } from '@helvetly/ui/lib/utils'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { AIWrite } from '@/components/ai/ai-write'
import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { FormSection } from '@/components/form-section'
import { ApiError, errorMessage } from '@/lib/api'
import { useHabits } from '@/lib/habits'
import { translate } from '@/lib/i18n'
import { formatMoney, UNITS, VAT_CATEGORIES, VAT_RATES, type VatCategory } from '@/lib/invoices'
import { useSaveProduct, type Product } from '@/lib/products'

import {
  DESCRIPTION_MAX,
  newValues,
  PRODUCT_HABITS,
  FIELD_ORDER,
  pricePreview,
  serverFieldErrors,
  toInput,
  validate,
  valuesFromProduct,
  type Defaults,
  type FieldErrors,
  type FormValues,
} from './product-form-model'

const fieldId = (field: keyof FormValues) => `product-${field}`

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
const CATEGORY_OPTIONS = VAT_CATEGORIES.map((category) => ({
  value: category.value,
  label: category.label,
  hint: category.value,
}))

/** Creates or edits a catalogue item in a drawer from the right (full width on phones). */
export function ProductForm({
  product,
  defaults,
  onClose,
  onSaved,
}: {
  /** The item to edit; none creates a new one. */
  product?: Product
  defaults: Defaults
  onClose: () => void
  onSaved: (product: Product, created: boolean) => void
}) {
  const { habits, remember } = useHabits()
  const [initial] = useState(() =>
    product ? valuesFromProduct(product) : newValues(defaults, habits),
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [discarding, setDiscarding] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const submitting = useRef(false)
  const save = useSaveProduct()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const preview = pricePreview(values)
  const standard = values.vat_category === 'S'

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
      )
  }

  const focusFirstError = (found: FieldErrors) => {
    const first = FIELD_ORDER.find((field) => found[field])
    if (first) document.getElementById(fieldId(first))?.focus()
  }

  const submit = () => {
    if (submitting.current) return
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length) return focusFirstError(found)
    submitting.current = true
    save.mutate(
      { id: product?.id, input: toInput(values) },
      {
        onSuccess: (saved) => {
          if (!product) remember('product', values, PRODUCT_HABITS)
          toast.success(
            product
              ? translate('saved', { name: saved.name })
              : translate('addedToTheCatalogue', { name: saved.name }),
          )
          onSaved(saved, !product)
        },
        onError: (error) => {
          submitting.current = false
          const fromServer =
            error instanceof ApiError && error.status === 422
              ? serverFieldErrors(error.details)
              : {}
          if (Object.keys(fromServer).length) {
            setErrors(fromServer)
            focusFirstError(fromServer)
          } else toast.error(errorMessage(error))
        },
      },
    )
  }

  // ⌘Enter / Ctrl+Enter saves from anywhere in the form (the drawer mounts it after this effect).
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
  const title = product
    ? translate('edit3', { name: product.name })
    : translate('newProductOrService')

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          document.getElementById(fieldId('name'))?.focus()
        }}
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('catalogueItem')}</SheetDescription>
        <form
          ref={form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 md:px-8">
            <div className="grid min-w-0 gap-0.5">
              <h2 className="truncate text-lg font-semibold">{title}</h2>
              <p className="text-[13px] text-muted-foreground">
                {translate('aNameAndAPriceAreEnoughInvoicesCopy')}
              </p>
            </div>
            <Segmented
              label={translate('itemType')}
              value={values.type}
              options={[
                { value: 'service', label: translate('service') },
                { value: 'product', label: translate('product') },
              ]}
              onChange={(type) => set('type', type)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <FormSection
              title={translate('basics')}
              description={translate('whatYouSellAsItAppearsOnInvoiceLines')}
            >
              <FormField field="name" label={translate('name')} error={errors.name} required>
                <input
                  {...describe('name')}
                  value={values.name}
                  onChange={(event) => set('name', event.target.value)}
                  placeholder={
                    values.type === 'product'
                      ? translate('ergonomicOfficeChair')
                      : translate('webDesignHourly')
                  }
                  className={inputClass}
                />
              </FormField>
              <FormField
                field="description"
                label={translate('description')}
                error={errors.description}
                tip={translate('printedUnderTheNameOnTheInvoiceLine')}
                hint={
                  <span className="flex items-center justify-between gap-2">
                    <AIWrite
                      field="product_description"
                      text={values.description}
                      maxLength={DESCRIPTION_MAX}
                      context={{
                        name: values.name,
                        kind: values.type,
                        unit: values.unit ?? undefined,
                        price: values.unit_price && `${values.currency} ${values.unit_price}`,
                      }}
                      onApply={(text) => set('description', text)}
                    />
                    <span
                      className={cn(
                        'tabular-nums',
                        values.description.length > DESCRIPTION_MAX && 'text-destructive',
                      )}
                    >
                      {values.description.length} / {DESCRIPTION_MAX}
                    </span>
                  </span>
                }
              >
                <textarea
                  {...describe('description')}
                  rows={3}
                  value={values.description}
                  onChange={(event) => set('description', event.target.value)}
                  placeholder={translate('whatTheClientGetsEGDesignTwoRevision')}
                  className={cn(inputClass, 'h-auto min-h-20 resize-y py-2')}
                />
              </FormField>
            </FormSection>

            <FormSection
              title={translate('price2')}
              description={translate('whatYouChargeThePreviewShowsTheAmountsPer')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  field="unit_price"
                  label={translate('unitPrice')}
                  className="sm:col-span-2"
                  error={errors.unit_price}
                  required
                  tip={translate('enterThePriceAsYouQuoteItNetWithout')}
                >
                  <div className="flex gap-1.5">
                    <input
                      {...describe('unit_price')}
                      inputMode="decimal"
                      value={values.unit_price}
                      onChange={(event) => set('unit_price', event.target.value)}
                      placeholder="0.00"
                      className={cn(inputClass, 'min-w-0 text-right tabular-nums')}
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
                <FormField
                  field="currency"
                  label={translate('currency')}
                  error={errors.currency}
                  required
                >
                  <Combobox
                    id={fieldId('currency')}
                    value={values.currency}
                    options={CURRENCY_OPTIONS}
                    renderValue={(option) => `${option.value} · ${option.label}`}
                    placeholder={translate('chooseACurrency2')}
                    invalid={Boolean(errors.currency)}
                    onChange={(code) => set('currency', code)}
                  />
                </FormField>
                <FormField
                  field="vat_category"
                  label={translate('vat')}
                  error={errors.vat_category}
                  required
                  tip={translate('theEN16931CategoryTheInvoiceLineGetsStandard')}
                >
                  <Combobox
                    id={fieldId('vat_category')}
                    value={values.vat_category}
                    options={CATEGORY_OPTIONS}
                    placeholder={translate('chooseAVATCategory')}
                    onChange={(code) => {
                      const category = VAT_CATEGORIES.find((entry) => entry.value === code)?.value
                      if (!category) return
                      set('vat_category', category satisfies VatCategory)
                      if (category !== 'S') set('vat_rate', '0')
                      else if (!standard) set('vat_rate', defaults.default_vat_rate)
                    }}
                  />
                </FormField>
                <FormField
                  field="vat_rate"
                  label={translate('vatRate')}
                  error={errors.vat_rate}
                  required={standard}
                >
                  <div className="flex gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <input
                        {...describe('vat_rate')}
                        inputMode="decimal"
                        disabled={!standard}
                        value={standard ? values.vat_rate : '0'}
                        onChange={(event) => set('vat_rate', event.target.value)}
                        placeholder="8.1"
                        className={cn(
                          inputClass,
                          'pr-7 text-right tabular-nums disabled:opacity-60',
                        )}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                    {standard && (
                      <span className="flex gap-1">
                        {VAT_RATES.map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => set('vat_rate', rate)}
                            className={cn(
                              'h-9 cursor-pointer rounded-md px-2 text-[13px] tabular-nums ring-1 ring-border transition-colors ring-inset hover:bg-muted',
                              values.vat_rate === rate &&
                                'bg-muted text-foreground ring-foreground/20',
                            )}
                          >
                            {rate}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </FormField>
              </div>
              <output
                aria-label={translate('pricePerUnit')}
                className="grid grid-cols-3 divide-x divide-border/70 rounded-lg ring-1 ring-border/70"
              >
                {(['net', 'vat', 'gross'] as const).map((key) => (
                  <span key={key} className="grid gap-0.5 px-3 py-2.5">
                    <span className="text-[12px] text-muted-foreground">
                      {key === 'net'
                        ? translate('net2')
                        : key === 'vat'
                          ? translate('vat')
                          : translate('gross')}
                      {key === values.price_basis && translate('entered')}
                    </span>
                    <span className="text-[15px] font-medium tabular-nums">
                      {preview ? formatMoney(preview[key], values.currency || '—') : '—'}
                    </span>
                  </span>
                ))}
              </output>
            </FormSection>

            <FormSection
              title={translate('details')}
              description={translate('optionalCodesForYourOwnRecords')}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  field="unit"
                  label={translate('unit')}
                  error={errors.unit}
                  tip={translate('howTheQuantityIsCountedOnTheInvoice')}
                >
                  <Combobox
                    id={fieldId('unit')}
                    value={values.unit}
                    options={UNIT_OPTIONS}
                    placeholder={translate('noUnit')}
                    onChange={(code) =>
                      set('unit', UNITS.find((unit) => unit.value === code)?.value ?? '')
                    }
                  />
                </FormField>
                <FormField
                  field="sku"
                  label="SKU"
                  error={errors.sku}
                  tip={translate('yourInternalCodeUniqueAmongYourActiveItems')}
                >
                  <input
                    {...describe('sku')}
                    value={values.sku}
                    onChange={(event) => set('sku', event.target.value)}
                    placeholder={translate('webHOUR')}
                    className={cn(inputClass, 'font-mono text-[13px]')}
                  />
                </FormField>
                {values.type === 'product' && (
                  <FormField
                    field="gtin"
                    label={translate('gtinEAN')}
                    error={errors.gtin}
                    tip={translate('theBarcodeNumberGTIN81213Or14')}
                  >
                    <input
                      {...describe('gtin')}
                      inputMode="numeric"
                      value={values.gtin}
                      onChange={(event) => set('gtin', event.target.value)}
                      placeholder="7612345678900"
                      className={cn(inputClass, 'font-mono text-[13px]')}
                    />
                  </FormField>
                )}
              </div>
            </FormSection>
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
                : product
                  ? translate('saveChanges')
                  : translate('addItem')}
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
