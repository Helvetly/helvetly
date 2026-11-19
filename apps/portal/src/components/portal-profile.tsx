'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Combobox, inputClass } from '@helvetly/ui/components/combobox'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
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
import { Building2, CircleX, Clock, Landmark, Mail, MapPin, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
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
const FIELDS: { key: Key; label: string; wide?: boolean }[] = [
  { key: 'name', label: translate('name'), wide: true },
  { key: 'billing_email', label: translate('billingEmail') },
  { key: 'phone', label: translate('phone') },
  { key: 'street', label: translate('street') },
  { key: 'street_number', label: translate('number') },
  { key: 'apt', label: translate('apartment') },
  { key: 'zip', label: 'ZIP' },
  { key: 'city', label: translate('city') },
  { key: 'country', label: translate('country') },
  { key: 'vat_number', label: translate('vatNumber') },
  { key: 'registration_number', label: translate('registrationNumber') },
]
const GROUPS: { title: string; icon: LucideIcon; keys: Key[] }[] = [
  { title: translate('company'), icon: Building2, keys: ['name'] },
  { title: translate('contact'), icon: Mail, keys: ['billing_email', 'phone'] },
  {
    title: translate('address'),
    icon: MapPin,
    keys: ['street', 'street_number', 'apt', 'zip', 'city', 'country'],
  },
  { title: translate('taxIDs'), icon: Landmark, keys: ['vat_number', 'registration_number'] },
]
const labelOf = (key: string) => FIELDS.find((f) => f.key === key)?.label ?? key
const text = (value: string | null | undefined) => value ?? ''

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

export function PortalProfile() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: portalKeys.profile, queryFn: getPortalProfile })
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({})
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
  const rejected = !pending && decision?.status === 'rejected' && recent(decision.decided_at)
  const phoneField = phone ?? phoneDraft(profile.phone, profile.country)
  // E.164 once valid, so an untouched or re-typed number isn't a change; else as typed.
  const typedPhone = phone
    ? phone.phone.trim() && (toE164(phone.phone, phone.country) ?? phone.phone)
    : text(profile.phone)
  const value = (key: Key) => (key === 'phone' ? typedPhone : (draft[key] ?? text(profile[key])))
  const changed = FIELDS.filter(({ key }) => value(key) !== text(profile[key]))
  const set = (key: Key, next: string) => {
    setDraft((d) => ({ ...d, [key]: next }))
    setErrors(({ [key]: _cleared, ...rest }) => rest)
  }
  const send = () => {
    if (phone?.phone.trim() && !toE164(phone.phone, phone.country))
      return setErrors((current) => ({ ...current, phone: PHONE_ERROR }))
    submit.mutate(
      Object.fromEntries(
        changed.map(({ key }) => [key, value(key).trim() || null]),
      ) as Partial<ProfileFields>,
    )
  }

  const field = (key: Key) =>
    key === 'country' ? (
      <Combobox
        id={`portal-${key}`}
        value={value(key)}
        options={COUNTRY_OPTIONS}
        invalid={Boolean(errors[key])}
        placeholder={translate('chooseACountry')}
        onChange={(code) => set(key, code)}
      />
    ) : key === 'phone' ? (
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
        onCountryChange={(code) => setPhone({ ...phoneField, country: phoneCountryOr(code) })}
      />
    ) : (
      <input
        id={`portal-${key}`}
        value={value(key)}
        onChange={(event) => set(key, event.target.value)}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `portal-${key}-error` : undefined}
        className={inputClass}
      />
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
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {GROUPS.map(({ title, icon: Icon, keys }) => (
          <fieldset key={title} className={cn(cardClass, 'grid gap-4 p-4 sm:p-6')}>
            <legend className="float-left flex items-center gap-2 text-title-sm font-medium">
              <span className="flex size-7 items-center justify-center rounded-lg bg-section-icon-surface text-section-icon">
                <Icon className="size-4" aria-hidden />
              </span>
              {title}
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FIELDS.filter((f) => keys.includes(f.key)).map(({ key, label, wide }) => (
                <FormField
                  key={key}
                  id={`portal-${key}`}
                  label={label}
                  error={errors[key]}
                  className={wide ? 'col-span-2 sm:col-span-4' : 'col-span-2'}
                >
                  {field(key)}
                </FormField>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
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
