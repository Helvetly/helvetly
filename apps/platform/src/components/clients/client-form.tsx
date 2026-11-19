'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField as SharedField } from '@helvetly/ui/components/form-field'
import { Kbd } from '@helvetly/ui/components/kbd'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { phoneCountry } from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import { DoorOpen, Lock, MapPin, Receipt, UserRound } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { FormSection } from '@/components/form-section'
import { TextareaBox } from '@/components/textarea-box'
import { ApiError } from '@/lib/api'
import { EINVOICE_FORMATS, useSaveClient, type Client } from '@/lib/clients'
import { useHabits, withHabits } from '@/lib/habits'
import { translate } from '@/lib/i18n'
import type { RegisterCompany } from '@/lib/uid-register'

import {
  draftHint,
  emptyValues,
  FIELD_ORDER,
  formatUid,
  LANGUAGE_OPTIONS,
  missingAddress,
  NOTE_MAX,
  RO_COUNTIES,
  serverFieldErrors,
  TERM_PRESETS,
  toInput,
  validate,
  valuesFromClient,
  type FieldErrors,
  type FormValues,
  CLIENT_HABIT_OPTIONS,
  CLIENT_HABITS,
} from './client-form-model'
import { invitationText, portalLogin, PortalStatus } from './client-portal'
import { Combobox, COUNTRY_OPTIONS, CURRENCY_OPTIONS, inputClass, TagsInput } from './fields'
import { RegisterCheckHint, RegisterNameInput } from './uid-register-fields'
import { registerApplies, registerFill, replacedFields, uidToCheck } from './uid-register-model'

const LANGUAGE_CHOICES = LANGUAGE_OPTIONS.map(({ code, name }) => ({ value: code, label: name }))

const fieldId = (field: keyof FormValues) => `client-${field}`

function FormField({
  field,
  ...props
}: Omit<ComponentProps<typeof SharedField>, 'id'> & { field: keyof FormValues }) {
  return <SharedField id={fieldId(field)} {...props} />
}

/** Creates or edits a client in one scrolling form, in a drawer from the right (full width on phones). */
export function ClientForm({
  client,
  focus,
  prefill,
  onClose,
  onSaved,
}: {
  /** The client to edit; none creates a new one. */
  client?: Client
  /** Scroll to and focus this section when the form opens. */
  focus?: 'address'
  /** What a new client starts with, e.g. the details an imported document gave; they win over learned habits. */
  prefill?: Partial<FormValues>
  onClose: () => void
  onSaved: (client: Client, created: boolean) => void
}) {
  const { habits, remember } = useHabits()
  const [initial] = useState(() =>
    client
      ? valuesFromClient(client)
      : {
          ...withHabits(emptyValues(), habits, 'client', CLIENT_HABITS, {
            allowed: CLIENT_HABIT_OPTIONS,
            eager: ['is_company'],
          }),
          ...prefill,
        },
  )
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [discarding, setDiscarding] = useState(false)
  // A learned country counts as chosen: a phone typed later must not replace it.
  const [countryTouched, setCountryTouched] = useState(
    client ? Boolean(client.country) : initial.country !== emptyValues().country,
  )
  // The last company picked from the UID register: what it replaced, for undo.
  const [filled, setFilled] = useState<{ before: Partial<FormValues>; replaced: string[] } | null>(
    null,
  )
  const [customTerms, setCustomTerms] = useState(
    () => !TERM_PRESETS.includes(initial.payment_terms_days),
  )
  const form = useRef<HTMLFormElement>(null)
  const submitting = useRef(false)
  const save = useSaveClient()
  const dirty = JSON.stringify(values) !== JSON.stringify(initial)
  const missing = missingAddress(values)
  const hint = draftHint(missing)

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field])
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)),
      )
  }

  const pickCompany = (company: RegisterCompany) => {
    const fill = registerFill(values, company)
    const before = Object.fromEntries(
      Object.keys(fill).map((field) => [field, values[field as keyof FormValues]]),
    )
    setValues((current) => ({ ...current, ...fill }))
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([field]) => !(field in fill))),
    )
    setFilled({ before, replaced: replacedFields(values, fill) })
  }
  const undoFill = () => {
    if (!filled) return
    setValues((current) => ({ ...current, ...filled.before }))
    setFilled(null)
    document.getElementById(fieldId('name'))?.focus()
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
      { id: client?.id, input: toInput(values, Boolean(client)) },
      {
        onSuccess: (saved) => {
          if (!client) remember('client', values, CLIENT_HABITS)
          toast.success(
            client
              ? translate('saved', { name: saved.name })
              : translate('addedAs', { name: saved.name, number: saved.number }),
          )
          onSaved(saved, !client)
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
          } else toastError(error)
        },
      },
    )
  }

  // ⌘Enter / Ctrl+Enter saves from anywhere in the form.
  // The drawer's portal mounts the form after this effect, so the listener sits on the window.
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
  const company = values.is_company
  const login = portalLogin(values)
  const initialLogin = portalLogin(initial)

  const body = (
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
          <h2 className="truncate text-lg font-semibold">
            {client ? translate('edit3', { name: client.name }) : translate('newClient')}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {translate('onlyTheNameIsRequiredYouCanCompleteThe')}
          </p>
        </div>
        <Segmented
          label={translate('clientType')}
          value={company ? 'company' : 'person'}
          options={[
            { value: 'company', label: translate('company') },
            { value: 'person', label: translate('person') },
          ]}
          onChange={(type) => set('is_company', type === 'company')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FormSection
          icon={UserRound}
          title={translate('basics')}
          description={translate('whoTheClientIsAndHowToReachThem')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              field="name"
              label={company ? translate('companyName') : translate('fullName')}
              error={errors.name}
              required
              hint={
                filled && (
                  <output>
                    {filled.replaced.length
                      ? translate('filledFromUIDRegisterReplaced', {
                          fields: filled.replaced.join(', '),
                        })
                      : translate('filledFromUIDRegister')}{' '}
                    <button
                      type="button"
                      onClick={undoFill}
                      className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
                    >
                      {translate('undo')}
                    </button>
                  </output>
                )
              }
            >
              <RegisterNameInput
                {...describe('name')}
                required
                lookup={registerApplies(values)}
                value={values.name}
                autoComplete={company ? 'organization' : 'name'}
                placeholder={company ? translate('musterAG') : translate('annaMuster')}
                onChange={(name) => set('name', name)}
                onPick={pickCompany}
                className={inputClass}
              />
            </FormField>
            <FormField
              field="preferred_name"
              label={company ? translate('contactPerson') : translate('preferredName')}
              error={errors.preferred_name}
            >
              <input
                {...describe('preferred_name')}
                value={values.preferred_name}
                onChange={(event) => set('preferred_name', event.target.value)}
                placeholder={company ? translate('annaMuster') : translate('anna')}
                className={inputClass}
              />
            </FormField>
            <FormField field="email" label={translate('email')} error={errors.email}>
              <input
                {...describe('email')}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={values.email}
                onChange={(event) => set('email', event.target.value)}
                placeholder={translate('helloExampleCh')}
                className={inputClass}
              />
            </FormField>
            <FormField
              field="billing_email"
              label={translate('invoicesGoTo')}
              error={errors.billing_email}
              tip={translate('leaveEmptyToSendInvoicesToTheMainEmail')}
            >
              <input
                {...describe('billing_email')}
                type="email"
                inputMode="email"
                value={values.billing_email}
                onChange={(event) => set('billing_email', event.target.value)}
                placeholder={values.email.trim() || translate('accountsExampleCh')}
                className={inputClass}
              />
            </FormField>
            <FormField field="phone" label={translate('phone')} error={errors.phone}>
              <PhoneInput
                id={fieldId('phone')}
                value={values.phone}
                country={values.phone_country}
                invalid={Boolean(errors.phone)}
                onChange={(phone) => {
                  set('phone', phone)
                  // An address with no country yet follows the phone's (e.g. "+49…" → Germany).
                  const detected = phoneCountry(phone, values.phone_country)
                  if (detected && !countryTouched) set('country', detected)
                }}
                onCountryChange={(code) => {
                  set('phone_country', code as FormValues['phone_country'])
                  if (!countryTouched) set('country', code)
                }}
              />
            </FormField>
            <FormField field="website" label={translate('website')} error={errors.website}>
              <input
                {...describe('website')}
                type="url"
                inputMode="url"
                value={values.website}
                onChange={(event) => set('website', event.target.value)}
                placeholder="example.ch"
                className={inputClass}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={MapPin}
          title={translate('address')}
          description={translate('printedOnInvoicesNeededBeforeIssuing')}
          tip={hint ?? undefined}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-4 sm:grid-cols-[minmax(0,1fr)_110px_110px]">
            <FormField field="street" label={translate('street')} error={errors.street}>
              <input
                {...describe('street')}
                autoComplete="address-line1"
                value={values.street}
                onChange={(event) => set('street', event.target.value)}
                placeholder={translate('bahnhofstrasse')}
                className={inputClass}
              />
            </FormField>
            <FormField
              field="street_number"
              label={translate('number')}
              error={errors.street_number}
            >
              <input
                {...describe('street_number')}
                value={values.street_number}
                onChange={(event) => set('street_number', event.target.value)}
                placeholder="12"
                className={inputClass}
              />
            </FormField>
            <FormField
              field="apt"
              label={translate('aptSuite')}
              error={errors.apt}
              className="col-span-2 sm:col-span-1"
            >
              <input
                {...describe('apt')}
                autoComplete="address-line2"
                value={values.apt}
                onChange={(event) => set('apt', event.target.value)}
                placeholder={translate('message3rdFloor')}
                className={inputClass}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 sm:grid-cols-[110px_minmax(0,1fr)_236px]">
            <FormField field="zip" label="ZIP" error={errors.zip}>
              <input
                {...describe('zip')}
                autoComplete="postal-code"
                value={values.zip}
                onChange={(event) => set('zip', event.target.value)}
                placeholder="8001"
                className={inputClass}
              />
            </FormField>
            <FormField field="city" label={translate('city')} error={errors.city}>
              <input
                {...describe('city')}
                autoComplete="address-level2"
                value={values.city}
                onChange={(event) => set('city', event.target.value)}
                placeholder={translate('zRich')}
                className={inputClass}
              />
            </FormField>
            <FormField
              field="country"
              label={translate('country')}
              error={errors.country}
              className="col-span-2 sm:col-span-1"
            >
              <Combobox
                id={fieldId('country')}
                value={values.country}
                options={COUNTRY_OPTIONS}
                invalid={Boolean(errors.country)}
                placeholder={translate('chooseACountry2')}
                onChange={(code) => {
                  setCountryTouched(true)
                  set('country', code)
                }}
              />
            </FormField>
            {values.country === 'RO' && (
              <FormField
                field="region"
                label={translate('countyJude')}
                error={errors.region}
                tip={translate('roEFacturaNeedsItForBucharestEnterThe')}
                className="col-span-2"
              >
                <Combobox
                  id={fieldId('region')}
                  value={values.region}
                  options={RO_COUNTIES}
                  invalid={Boolean(errors.region)}
                  placeholder={translate('chooseACounty')}
                  onChange={(code) => set('region', code)}
                />
              </FormField>
            )}
          </div>
          <FormField
            field="vat_number"
            label={translate('vatUIDNumber')}
            error={errors.vat_number}
            tip={translate('swissUIDLikeCHE123456789MWSTOr')}
            hint={uidToCheck(values.vat_number) && <RegisterCheckHint vat={values.vat_number} />}
          >
            <input
              {...describe('vat_number')}
              value={values.vat_number}
              onChange={(event) => set('vat_number', formatUid(event.target.value))}
              placeholder={translate('che123456789MWST')}
              className={cn(inputClass, 'font-mono text-[13px]')}
            />
          </FormField>
          <FormField
            field="registration_number"
            label={translate('businessRegistrationNumber')}
            error={errors.registration_number}
            tip={translate('theLegalRegistrationNumberSeparatelyFromVATUsedFor')}
          >
            <input
              {...describe('registration_number')}
              value={values.registration_number}
              onChange={(event) => set('registration_number', event.target.value)}
              maxLength={100}
              placeholder={translate('che123456789')}
              className={inputClass}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              field="electronic_scheme"
              label={translate('eInvoiceAddressScheme')}
              error={errors.electronic_scheme}
              tip={translate('useTheEASCodeRegisteredWithYourEInvoice')}
            >
              <input
                {...describe('electronic_scheme')}
                value={values.electronic_scheme}
                maxLength={4}
                onChange={(event) => set('electronic_scheme', event.target.value)}
                placeholder={translate('eG0088')}
                className={inputClass}
              />
            </FormField>
            <FormField
              field="electronic_id"
              label={translate('eInvoiceElectronicAddress')}
              error={errors.electronic_id}
            >
              <input
                {...describe('electronic_id')}
                value={values.electronic_id}
                maxLength={200}
                onChange={(event) => set('electronic_id', event.target.value)}
                placeholder="7612345678900"
                className={inputClass}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={Receipt}
          title={translate('billingDefaults')}
          description={translate('usedForNewInvoicesToThisClient')}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              field="language"
              label={translate('documentLanguage')}
              error={errors.language}
            >
              <Combobox
                id={fieldId('language')}
                value={values.language}
                options={LANGUAGE_CHOICES}
                placeholder={translate('chooseALanguage')}
                onChange={(code) => set('language', code as FormValues['language'])}
              />
            </FormField>
            <FormField field="currency" label={translate('currency')} error={errors.currency}>
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
          </div>
          <FormField
            field="payment_terms_days"
            label={translate('paymentTerms')}
            tip={translate('paymentTermsHelp')}
            error={errors.payment_terms_days}
          >
            <div className="flex min-h-9 flex-wrap items-center gap-2">
              <Segmented
                label={translate('paymentTerms')}
                value={customTerms ? 'custom' : values.payment_terms_days}
                options={[
                  ...TERM_PRESETS.map((days) => ({
                    value: days,
                    label: translate('days3', { days: days }),
                  })),
                  { value: 'custom', label: translate('custom') },
                ]}
                onChange={(choice) => {
                  setCustomTerms(choice === 'custom')
                  if (choice !== 'custom') set('payment_terms_days', choice)
                }}
              />
              {customTerms && (
                <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
                  <input
                    {...describe('payment_terms_days')}
                    inputMode="numeric"
                    value={values.payment_terms_days}
                    onChange={(event) =>
                      set('payment_terms_days', event.target.value.replace(/\D/g, '').slice(0, 3))
                    }
                    aria-label={translate('days2')}
                    className={cn(inputClass, 'w-20 tabular-nums')}
                  />
                  {translate('days')}
                </span>
              )}
            </div>
          </FormField>
          <SwitchRow
            id="client-dunning"
            label={translate('paymentReminders')}
            description={translate('overdueInvoicesGetDunningRemindersWhenDunningIsOn')}
            checked={values.dunning_enabled}
            onCheckedChange={(on) => set('dunning_enabled', on)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              field="einvoice_format"
              label={translate('eInvoice')}
              error={errors.einvoice_format}
              tip={translate('attachedAsXMLNextToThePDFWhenYou')}
            >
              <Combobox
                id={fieldId('einvoice_format')}
                value={values.einvoice_format}
                options={EINVOICE_FORMATS}
                placeholder={translate('chooseAFormat')}
                onChange={(format) =>
                  set('einvoice_format', format as FormValues['einvoice_format'])
                }
              />
            </FormField>
            <FormField
              field="leitweg_id"
              label={translate('leitwegID')}
              error={errors.leitweg_id}
              tip={translate('forAGermanPublicBodyItsRoutingIDUsed')}
            >
              <input
                {...describe('leitweg_id')}
                value={values.leitweg_id}
                onChange={(event) => set('leitweg_id', event.target.value)}
                placeholder="04011000-1234512345-06"
                spellCheck={false}
                className={cn(inputClass, 'font-mono')}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={DoorOpen}
          title={translate('clientPortal')}
          description={translate('whereTheClientSeesItsInvoicesEngagementsAndShared')}
          tip={translate('theClientSignsInWithAnEmailedCodeThere')}
        >
          <SwitchRow
            id="client-portal"
            label={translate('letTheClientSignIn')}
            description={translate('withItsEmailOrTheBillingEmailWhenThere')}
            checked={values.portal_enabled}
            onCheckedChange={(on) => set('portal_enabled', on)}
          />
          {values.portal_enabled && (
            <PortalStatus
              login={login}
              fallback={!values.email.trim()}
              onAddEmail={() => document.getElementById(fieldId('email'))?.focus()}
              invitation={
                login !== initialLogin || !initial.portal_enabled
                  ? translate('whenYouSaveGetsAnEmailWithThePortal', { login: login })
                  : invitationText(client?.portal_invited_at)
              }
            />
          )}
        </FormSection>

        <FormSection
          icon={Lock}
          title={translate('internal')}
          description={translate('onlyVisibleToYourTeam')}
        >
          <FormField field="tags" label={translate('tags')} error={errors.tags}>
            <TagsInput
              id={fieldId('tags')}
              value={values.tags}
              invalid={Boolean(errors.tags)}
              onChange={(tags) => set('tags', tags)}
            />
          </FormField>
          <FormField
            field="internal_id"
            label={translate('internalID')}
            error={errors.internal_id}
            tip={translate('theClientSOwnReferenceEGTheirCustomer')}
          >
            <input
              {...describe('internal_id')}
              value={values.internal_id}
              onChange={(event) => set('internal_id', event.target.value)}
              placeholder={translate('k1042')}
              className={inputClass}
            />
          </FormField>
          <FormField
            field="note"
            label={translate('note')}
            error={errors.note}
            hint={translate('onlyYourTeamSeesThis')}
          >
            <TextareaBox
              {...describe('note')}
              rows={3}
              value={values.note}
              onChange={(event) => set('note', event.target.value)}
              placeholder={translate('anythingYourTeamShouldKnowAboutThisClient')}
              max={NOTE_MAX}
            />
          </FormField>
          {client && (
            <SwitchRow
              id="client-active"
              label={translate('active')}
              description={translate('inactiveClientsAreHiddenFromPickers')}
              checked={values.is_active}
              onCheckedChange={(on) => set('is_active', on)}
            />
          )}
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
            : client
              ? translate('saveChanges')
              : translate('addClient')}
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
  )

  const title = client ? translate('edit3', { name: client.name }) : translate('newClient')
  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        side="right"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const element = document.getElementById(
            focus === 'address' ? fieldId(missing[0] ?? 'street') : fieldId('name'),
          )
          element?.scrollIntoView({ block: 'center' })
          element?.focus()
        }}
        // Escape in an open suggestion list closes the list, not the drawer.
        onEscapeKeyDown={(event) => {
          if (document.activeElement?.closest('[data-suggesting]')) event.preventDefault()
        }}
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 p-0 sm:w-[min(900px,calc(100vw-6rem))]! dark:bg-card"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{translate('clientDetails')}</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  )
}
