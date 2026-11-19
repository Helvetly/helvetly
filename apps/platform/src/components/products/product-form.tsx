'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { cn } from '@helvetly/ui/lib/utils'
import { Banknote, Info, Tag } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { AIWrite } from '@/components/ai/ai-write'
import { Combobox, CURRENCY_OPTIONS, inputClass } from '@/components/clients/fields'
import { FormSection } from '@/components/form-section'
import { TextareaBox } from '@/components/textarea-box'
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
              icon={Info}
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
              >
                <TextareaBox
                  {...describe('description')}
                  rows={3}
                  value={values.description}
                  onChange={(event) => set('description', event.target.value)}
                  placeholder={translate('whatTheClientGetsEGDesignTwoRevision')}
                  max={DESCRIPTION_MAX}
                  tools={
                    <AIWrite
                      field="product_description"
                      text={values.description}
                      maxLength={DESCRIPTION_MAX}
                      context={{
                        name: values.name,
                        kind: values.type,
                        price:
                          values.unit_price &&
                          `${values.currency} ${values.unit_price} ${values.price_basis}`,
                        unit: UNITS.find((unit) => unit.value === values.unit)?.label,
                        vat: VAT_CATEGORIES.find((entry) => entry.value === values.vat_category)
                          ?.label,
                        vat_rate: standard ? `${values.vat_rate} %` : undefined,
                        sku: values.sku,
                        gtin: values.type === 'product' ? values.gtin : undefined,
                      }}
                      onApply={(text) => set('description', text)}
                    />
                  }
                />
              </FormField>
            </FormSection>

            <FormSection
              icon={Banknote}
              title={translate('price2')}
              description={translate('whatYouChargeThePreviewShowsTheAmountsPer')}
            >
              <FormField
                field="unit_price"
                label={translate('unitPrice')}
                error={errors.unit_price ?? errors.currency}
                required
                tip={translate('enterThePriceAsYouQuoteItNetWithout')}
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
              <FormField
                field="vat_category"
                label={translate('vat')}
                error={errors.vat_category ?? errors.vat_rate}
                required
                tip={translate('theEN16931CategoryTheInvoiceLineGetsStandard')}
              >
                <div className="flex items-stretch gap-2">
                  <Combobox
                    id={fieldId('vat_category')}
                    value={values.vat_category}
                    options={CATEGORY_OPTIONS}
                    placeholder={translate('chooseAVATCategory')}
                    className="min-w-0 flex-1 shrink"
                    onChange={(code) => {
                      const category = VAT_CATEGORIES.find((entry) => entry.value === code)?.value
                      if (!category) return
                      set('vat_category', category satisfies VatCategory)
                      if (category !== 'S') set('vat_rate', '0')
                      else if (!standard) set('vat_rate', defaults.default_vat_rate)
                    }}
                  />
                  {standard && (
                    <>
                      <div className="relative w-24 shrink-0">
                        <input
                          {...describe('vat_rate')}
                          aria-label={translate('vatRate')}
                          aria-describedby={
                            errors.vat_rate ? `${fieldId('vat_category')}-error` : undefined
                          }
                          inputMode="decimal"
                          value={values.vat_rate}
                          onChange={(event) => set('vat_rate', event.target.value)}
                          placeholder="8.1"
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
                        label={translate('vatRatePresets')}
                        value={values.vat_rate}
                        options={VAT_RATES.map((rate) => ({ value: rate, label: rate }))}
                        onChange={(rate) => set('vat_rate', rate)}
                      />
                    </>
                  )}
                </div>
              </FormField>
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
              icon={Tag}
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
