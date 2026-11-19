'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Combobox, inputClass } from '@helvetly/ui/components/combobox'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
import { formatUid, isEmail, isValidUid, isWebsite } from '@helvetly/ui/lib/client-fields'
import { COUNTRY_OPTIONS } from '@helvetly/ui/lib/countries'
import { formatDate } from '@helvetly/ui/lib/format'
import { ApiError, errorMessage } from '@helvetly/ui/lib/http'
import {
  displayPhone,
  PHONE_ERROR,
  phoneCountryOr,
  phoneDraft,
  toE164,
  type CountryCode,
} from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CircleX,
  Clock,
  Landmark,
  Mail,
  MapPin,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { translate } from '@/lib/i18n'
import {
  getPortalProfile,
  portalKeys,
  requestProfileChange,
  type ProfileFields,
} from '@/lib/portal'

import { cardClass, PageHeader, RetryAlert } from './portal-bits'
import { PortalPhoto } from './portal-photo'

type Key = keyof ProfileFields
type Values = Record<Key, string>

const LABELS: Record<Key, string> = {
  name: translate('name'),
  preferred_name: translate('contactPerson'),
  billing_email: translate('invoicesGoTo'),
  phone: translate('phone'),
  website: translate('website'),
  street: translate('street'),
  street_number: translate('number'),
  apt: translate('aptSuite'),
  zip: 'ZIP',
  city: translate('city'),
  country: translate('country'),
  vat_number: translate('vatUIDNumber'),
  registration_number: translate('businessRegistrationNumber'),
}
const KEYS = Object.keys(LABELS) as Key[]
const labelOf = (key: string) => LABELS[key as Key] ?? key
const text = (value: string | null | undefined) => value ?? ''

/** The platform client form's rules (client-form-model), for the fields a client changed. */
function validate(values: Values, changed: Key[], company: boolean): Partial<Record<Key, string>> {
  const errors: Partial<Record<Key, string>> = {}
  const has = (key: Key) => changed.includes(key) && values[key].trim() !== ''
  if (changed.includes('name') && !values.name.trim())
    errors.name = company ? translate('enterTheCompanyName') : translate('enterTheFullName')
  if (has('billing_email') && !isEmail(values.billing_email.trim()))
    errors.billing_email = translate('enterAValidEmailAddress')
  if (has('website') && !isWebsite(values.website.trim()))
    errors.website = translate('enterAWebsiteEGExampleCh')
  // The server checks every number starting with CH as a Swiss UID.
  if (has('vat_number') && /^CH/i.test(values.vat_number.trim()) && !isValidUid(values.vat_number))
    errors.vat_number = translate('thisUIDNumberIsnTValidCheckTheDigits')
  return errors
}

/** 422 `details.fields` as { field: message }; the server's code (e.g. "invalid") becomes a sentence. */
function fieldErrors(error: unknown): Record<string, string> {
  const fields = error instanceof ApiError ? error.details.fields : null
  if (typeof fields !== 'object' || fields === null) return {}
  return Object.fromEntries(
    Object.entries(fields).map(([key, code]) => [
      key,
      code === 'required' ? translate('required') : translate('thisValueIsnTValid'),
    ]),
  )
}

/** A rejection stays on the profile for 30 days, then the details speak for themselves. */
const recent = (decidedAt: string | null) =>
  decidedAt !== null && Date.now() - Date.parse(decidedAt) < 30 * 86_400_000

/** A titled card of fields, its icon tile as in the platform's forms. */
function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <fieldset className={cn(cardClass, 'grid min-w-0 gap-5 p-4 sm:p-6')}>
      <legend className="float-left flex items-center gap-2 text-title-sm font-medium">
        <span className="flex size-7 items-center justify-center rounded-lg bg-section-icon-surface text-section-icon">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

export function PortalProfile() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: portalKeys.profile, queryFn: getPortalProfile })
  const [draft, setDraft] = useState<Partial<Values>>({})
  // The phone as typed, in its picked country; null until edited.
  const [phone, setPhone] = useState<{ phone: string; country: CountryCode } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = useMutation({
    mutationFn: requestProfileChange,
    onSuccess: () => {
      setDraft({})
      setPhone(null)
      setErrors({})
      void queryClient.invalidateQueries({ queryKey: portalKeys.profile })
    },
    onError: (error) => {
      const found = fieldErrors(error)
      setErrors(found)
      if (Object.keys(found).length === 0) toast.error(errorMessage(error))
    },
  })

  const header = (
    <PageHeader title={translate('profile')}>
      {translate('theDetailsYourSupplierHasOnFileChangesAre')}
    </PageHeader>
  )
  if (query.isPending)
    return (
      <div className="grid gap-6 sm:gap-8">
        {header}
        <Loader className="min-h-72" />
      </div>
    )
  if (query.error)
    return (
      <div className="grid gap-6 sm:gap-8">
        {header}
        <div className={cn(cardClass, 'p-4 sm:p-6')}>
          <RetryAlert what={translate('yourDetails')} onRetry={() => void query.refetch()} />
        </div>
      </div>
    )

  const { profile, pending, last_decision: decision } = query.data
  const company = profile.is_company
  const rejected = !pending && decision?.status === 'rejected' && recent(decision.decided_at)
  const phoneField = phone ?? phoneDraft(profile.phone, profile.country)
  // E.164 once valid, so an untouched or re-typed number isn't a change; else as typed.
  const typedPhone = phone
    ? phone.phone.trim() && (toE164(phone.phone, phone.country) ?? phone.phone)
    : text(profile.phone)
  const value = (key: Key) => (key === 'phone' ? typedPhone : (draft[key] ?? text(profile[key])))
  const values = Object.fromEntries(KEYS.map((key) => [key, value(key)])) as Values
  const changed = KEYS.filter((key) => values[key] !== text(profile[key]))
  const set = (key: Key, next: string) => {
    setDraft((d) => ({ ...d, [key]: next }))
    setErrors(({ [key]: _cleared, ...rest }) => rest)
  }
  const send = () => {
    const found: Record<string, string> = validate(values, changed, company)
    if (phone?.phone.trim() && !toE164(phone.phone, phone.country)) found.phone = PHONE_ERROR
    const first = KEYS.find((key) => found[key])
    if (first) {
      setErrors(found)
      return document.getElementById(`portal-${first}`)?.focus()
    }
    submit.mutate(
      Object.fromEntries(
        changed.map((key) => [key, values[key].trim() || null]),
      ) as Partial<ProfileFields>,
    )
  }

  /** A text field with the platform client form's label, placeholder and help. */
  const field = (
    key: Key,
    props: {
      label?: string
      placeholder?: string
      tip?: string
      required?: boolean
      autoComplete?: string
      type?: 'email' | 'url'
      className?: string
      inputClassName?: string
      format?: (typed: string) => string
    } = {},
  ) => (
    <FormField
      id={`portal-${key}`}
      label={props.label ?? LABELS[key]}
      error={errors[key]}
      required={props.required}
      tip={props.tip}
      className={props.className}
    >
      <input
        {...describedBy(`portal-${key}`, errors[key])}
        type={props.type ?? 'text'}
        inputMode={props.type}
        required={props.required}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={values[key]}
        onChange={(event) => set(key, (props.format ?? String)(event.target.value))}
        className={cn(inputClass, props.inputClassName)}
      />
    </FormField>
  )

  return (
    <div className="grid gap-6 sm:gap-8">
      {header}
      <PortalPhoto />
      {pending && (
        <section aria-label={translate('pendingChangeRequest')}>
          <Callout tone="warning" icon={Clock} title={translate('waitingForApproval')}>
            <div className="grid gap-1.5">
              <p className="text-muted-foreground">
                {translate('youAskedForTheseChangesOn')}
                {formatDate(pending.created_at)}
                {translate('yourSupplierWillReviewThemSoon')}
              </p>
              <ul className="grid gap-0.5">
                {Object.entries(pending.fields).map(([key, requested]) => (
                  <li key={key} className="break-words">
                    <span className="text-muted-foreground">{labelOf(key)}: </span>
                    <strong className="font-medium">
                      {(key === 'phone' && requested ? displayPhone(requested) : requested) || '—'}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          </Callout>
        </section>
      )}
      {rejected && (
        <section aria-label={translate('rejectedChangeRequest')}>
          <Callout
            tone="neutral"
            icon={CircleX}
            title={translate('yourLastChangeRequestWasNotAccepted')}
          >
            <div className="grid gap-1.5">
              <p className="text-muted-foreground">
                {translate('yourSupplierKeptYourDetailsAsTheyWere')}
                {decision.decided_at &&
                  translate('dynamicOn', { value1: formatDate(decision.decided_at) })}
                {translate('youCanSendANewRequestBelow')}
              </p>
              {decision.reason && (
                <p className="break-words whitespace-pre-line">
                  <span className="text-muted-foreground">{translate('reason')}</span>
                  {decision.reason}
                </p>
              )}
            </div>
          </Callout>
        </section>
      )}
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <Section
          title={company ? translate('company') : translate('name')}
          icon={company ? Building2 : UserRound}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {field('name', {
              label: company ? translate('companyName') : translate('fullName'),
              placeholder: company ? translate('musterAG') : translate('annaMuster'),
              autoComplete: company ? 'organization' : 'name',
              required: true,
            })}
            {field('website', { type: 'url', placeholder: 'example.ch' })}
          </div>
        </Section>
        <Section title={translate('contact')} icon={Mail}>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('preferred_name', {
              label: company ? translate('contactPerson') : translate('preferredName'),
              placeholder: company ? translate('annaMuster') : translate('anna'),
            })}
            <FormField
              id="portal-email"
              label={translate('signInEmail')}
              tip={translate('signInEmailTip')}
            >
              <input
                id="portal-email"
                type="email"
                readOnly
                value={text(profile.email)}
                className={cn(inputClass, 'bg-muted/60 text-muted-foreground dark:bg-muted/60')}
              />
            </FormField>
            {field('billing_email', {
              type: 'email',
              tip: translate('leaveEmptyToSendInvoicesToTheMainEmail'),
              placeholder: text(profile.email) || translate('accountsExampleCh'),
            })}
            <FormField id="portal-phone" label={LABELS.phone} error={errors.phone}>
              <PhoneInput
                id="portal-phone"
                value={phoneField.phone}
                country={phoneField.country}
                invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'portal-phone-error' : undefined}
                onChange={(next) => {
                  setPhone({ ...phoneField, phone: next })
                  setErrors(({ phone: _cleared, ...rest }) => rest)
                }}
                onCountryChange={(code) =>
                  setPhone({ ...phoneField, country: phoneCountryOr(code) })
                }
              />
            </FormField>
          </div>
        </Section>
        <Section title={translate('address')} icon={MapPin}>
          {/* The platform's address rows: street wide, number and apartment narrow; then ZIP narrow, city, country. */}
          <div
            data-testid="address-line-1"
            className="grid grid-cols-[minmax(0,1fr)_96px] gap-4 sm:grid-cols-[minmax(0,1fr)_110px_110px]"
          >
            {field('street', {
              placeholder: translate('bahnhofstrasse'),
              autoComplete: 'address-line1',
            })}
            {field('street_number', { placeholder: '12' })}
            {field('apt', {
              placeholder: translate('message3rdFloor'),
              autoComplete: 'address-line2',
              className: 'col-span-2 sm:col-span-1',
            })}
          </div>
          <div
            data-testid="address-line-2"
            className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 sm:grid-cols-[110px_minmax(0,1fr)_236px]"
          >
            {field('zip', { placeholder: '8001', autoComplete: 'postal-code' })}
            {field('city', { placeholder: translate('zRich'), autoComplete: 'address-level2' })}
            <FormField
              id="portal-country"
              label={LABELS.country}
              error={errors.country}
              className="col-span-2 sm:col-span-1"
            >
              <Combobox
                id="portal-country"
                value={values.country}
                options={COUNTRY_OPTIONS}
                invalid={Boolean(errors.country)}
                placeholder={translate('chooseACountry')}
                onChange={(code) => set('country', code)}
              />
            </FormField>
          </div>
        </Section>
        <Section title={translate('taxIDs')} icon={Landmark}>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('vat_number', {
              tip: translate('swissUIDLikeCHE123456789MWSTOr'),
              placeholder: translate('che123456789MWST'),
              format: formatUid,
              inputClassName: 'font-mono text-body-sm',
            })}
            {field('registration_number', {
              tip: translate('theLegalRegistrationNumberSeparatelyFromVATUsedFor'),
              placeholder: translate('che123456789'),
            })}
          </div>
        </Section>
        {/* With a change typed, it stays in reach while scrolling (above the phone's bottom tab bar). */}
        <div
          className={cn(
            cardClass,
            'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6',
            changed.length > 0 &&
              'sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 md:bottom-4',
          )}
        >
          <Button type="submit" disabled={changed.length === 0 || submit.isPending}>
            {translate('requestChange')}
          </Button>
          <p className="text-body-sm text-muted-foreground">
            {translate('changesAreAppliedAfterApproval')}
          </p>
        </div>
      </form>
    </div>
  )
}
