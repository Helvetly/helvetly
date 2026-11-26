'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { PhoneInput } from '@helvetly/ui/components/phone-input'
import { Segmented } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import {
  PHONE_ERROR,
  phoneCountryOr,
  phoneDraft,
  toE164,
  type CountryCode,
} from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import {
  BellRing,
  Building2,
  CalendarRange,
  Check,
  CircleCheck,
  CloudOff,
  CreditCard,
  ExternalLink,
  FileCode,
  Globe,
  Hash,
  Image as ImageIcon,
  Landmark,
  Lock,
  MailCheck,
  PanelBottom,
  Percent,
  QrCode,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { formatUid, TERM_PRESETS } from '@/components/clients/client-form-model'
import {
  Combobox,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  inputClass,
  NativeSelect,
} from '@/components/clients/fields'
import { State } from '@/components/data/table-page'
import { DOCUMENT_TEXT_MAX } from '@/components/invoices/document-parts'
import {
  apiFieldErrors,
  UnsavedDot,
  useSectionForm,
  type FieldErrors,
  type SectionState,
} from '@/components/section-form'
import { ApprovalsRow } from '@/components/settings/approvals-row'
import { NextNumbersTip } from '@/components/settings/next-numbers-tip'
import { NumberFormatField } from '@/components/settings/number-format-field'
import { PercentInput } from '@/components/shared/percent-input'
import { TextareaBox } from '@/components/textarea-box'
import { ApiError, errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  invoiceKeys,
  invoicesApi,
  nextNumberOf,
  numberFormatError,
  formatIban,
  ibanInfo,
  INTERVALS,
  logoSrc,
  MISSING_LABELS,
  parseDecimalInput,
  revolutLink,
  revolutUsername,
  settingsFix,
  today,
  useInvoiceSettings,
  useSaveInvoiceSettings,
  VAT_RATES,
  type DocLanguage,
  type DunningSettings,
  type IbanInfo,
  type InstalmentSettings,
  type Interval,
  type InvoiceSettings,
  type NextNumbers,
  type NumberFormat,
  type NumberedKind,
  type SettingsInput,
  type VatMode,
  unsupportedSellerCountry,
} from '@/lib/invoices'
import { legalFormOptions, suggestLegalForm, useLegalForms } from '@/lib/legal-forms'
import { useCan } from '@/lib/permissions'

import { DunningSteps, stepErrors, timingProblems, type StepDraft } from './dunning-steps'
import { SettingsNotice, SettingsPage, SettingsPreview, SettingsSection } from './layout'
import { LogoDropzone } from './logo-upload'
import { SettingsHeader } from './settings-tabs'
import { UnitInput } from './unit-input'

const inputId = (field: string) => `settings-${field.replace('.', '-')}`

type Values = {
  name: string
  street: string
  street_number: string
  apt: string
  zip: string
  city: string
  country: string
  email: string
  phone: string
  phone_country: CountryCode
  website: string
  /** A code of the country's legal forms, '' when none is chosen. */
  legal_form: string
  vat_registered: boolean
  vat_number: string
  registration_number: string
  electronic_scheme: string
  electronic_id: string
  default_vat_mode: Exclude<VatMode, 'none'>
  default_vat_rate: string
  iban: string
  bank_name: string
  bic: string
  currency: string
  language: DocLanguage
  default_terms_days: string
  number_format: NumberFormat
  footer: string
  qr_bill_enabled: boolean
  revolut_enabled: boolean
  revolut_username: string
  instalments_count: string
  instalments_interval: Interval
  instalments_mode: InstalmentSettings['mode']
  instalments_plan_lead_days: string
  instalments_plan_auto_send: boolean
  instalments_reminders_enabled: boolean
  instalments_remind_before_days: string
  /** As typed: "3, 10". */
  instalments_remind_after_days: string
  dunning_enabled: boolean
  dunning_steps: StepDraft[]
  dunning_interest_enabled: boolean
  dunning_interest_rate: string
  dunning_interest_from: DunningSettings['interest_from']
  payment_confirmation: boolean
}

const afterDays = (typed: string) =>
  [
    ...new Set(
      typed
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number),
    ),
  ].toSorted((a, b) => a - b)

const joinDays = (days: number[]) =>
  days.length < 2
    ? days.join('')
    : translate('dynamicAnd', { value1: days.slice(0, -1).join(', '), value2: days.at(-1) })

/** The reminder settings in words, as the client will experience them. */
export function reminderSummary(beforeTyped: string, afterTyped: string): string {
  const before = Number(beforeTyped) || 0
  // Half-typed input ("3, 1x") shows only the days that already read as days.
  const after = afterDays(afterTyped).filter((day) => Number.isInteger(day) && day > 0)
  const parts = [
    before > 0 && `${before} ${before === 1 ? 'day' : 'days'} before`,
    after.length > 0 && `${joinDays(after)} ${after.at(-1) === 1 ? 'day' : 'days'} after`,
  ].filter(Boolean)
  if (parts.length === 0) return translate('noRemindersAreSent')
  return translate('yourClientGetsAReminderEachDueDateUntil', { value1: parts.join(', and ') })
}

/** An http(s) URL or a bare domain, as the API accepts it. */
function validWebsite(value: string): boolean {
  const text = value.trim()
  if (/\s/.test(text)) return false
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.')
  } catch {
    return false
  }
}

export function valuesFrom(settings: InvoiceSettings): Values {
  const { seller } = settings
  const { instalments } = settings
  const phone = phoneDraft(seller.phone, seller.country)
  return {
    name: seller.name,
    street: seller.street,
    street_number: seller.street_number,
    apt: seller.apt ?? '',
    zip: seller.zip,
    city: seller.city,
    country: seller.country,
    email: seller.email ?? '',
    phone: phone.phone,
    phone_country: phone.country,
    website: seller.website ?? '',
    legal_form: seller.legal_form ?? '',
    vat_registered: settings.vat_registered,
    vat_number: seller.vat_number ?? '',
    registration_number: seller.registration_number ?? '',
    electronic_scheme: seller.electronic_address?.scheme ?? '',
    electronic_id: seller.electronic_address?.id ?? '',
    default_vat_mode: settings.default_vat_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    default_vat_rate: settings.default_vat_rate,
    iban: settings.iban ? formatIban(settings.iban) : '',
    bank_name: settings.bank_name ?? '',
    bic: settings.bic ?? '',
    currency: settings.currency,
    language: settings.language,
    default_terms_days: String(settings.default_terms_days),
    number_format: settings.number_format,
    footer: settings.footer ?? '',
    qr_bill_enabled: settings.qr_bill_enabled,
    revolut_enabled: settings.revolut_enabled,
    revolut_username: settings.revolut_username ?? '',
    instalments_count: String(instalments.count),
    instalments_interval: instalments.interval,
    instalments_mode: instalments.mode,
    instalments_plan_lead_days: String(instalments.plan_lead_days),
    instalments_plan_auto_send: instalments.plan_auto_send,
    instalments_reminders_enabled: instalments.reminders_enabled,
    instalments_remind_before_days: String(instalments.remind_before_days),
    instalments_remind_after_days: instalments.remind_after_days.join(', '),
    dunning_enabled: settings.dunning.enabled,
    dunning_steps: settings.dunning.steps.map((step, i) => ({
      key: `step-${i}`,
      name: step.name ?? '',
      timing: step.timing,
      days: String(step.days),
      fee: step.fee,
      text: step.text ?? '',
      qr_bill: step.qr_bill,
    })),
    dunning_interest_enabled: settings.dunning.interest_enabled,
    dunning_interest_rate: settings.dunning.interest_rate,
    dunning_interest_from: settings.dunning.interest_from,
    payment_confirmation: settings.payment_confirmation,
  }
}

const orNull = (text: string) => text.trim() || null

export function toSettingsInput(values: Values): SettingsInput {
  return {
    seller: {
      name: values.name.trim(),
      street: values.street.trim(),
      street_number: values.street_number.trim(),
      apt: orNull(values.apt),
      zip: values.zip.trim(),
      city: values.city.trim(),
      country: values.country,
      vat_number: values.vat_registered ? orNull(values.vat_number) : null,
      email: orNull(values.email),
      // An invalid number goes as typed, for the API to refuse (the form shows the error first).
      phone: toE164(values.phone, values.phone_country) ?? orNull(values.phone),
      website: orNull(values.website),
      registration_number: orNull(values.registration_number),
      legal_form: values.legal_form || null,
      electronic_address:
        values.electronic_scheme.trim() || values.electronic_id.trim()
          ? { scheme: values.electronic_scheme.trim(), id: values.electronic_id.trim() }
          : null,
    },
    vat_registered: values.vat_registered,
    default_vat_mode: values.vat_registered ? values.default_vat_mode : 'none',
    default_vat_rate: parseDecimalInput(values.default_vat_rate, 2) ?? values.default_vat_rate,
    iban: orNull(values.iban),
    bank_name: orNull(values.bank_name),
    bic: orNull(values.bic),
    currency: values.currency,
    language: values.language,
    default_terms_days: Number(values.default_terms_days),
    number_format: values.number_format,
    footer: orNull(values.footer),
    qr_bill_enabled: values.qr_bill_enabled,
    revolut_enabled: values.revolut_enabled,
    // A pasted link is saved as its username; anything else goes as typed, for the API to refuse.
    revolut_username: revolutUsername(values.revolut_username) ?? orNull(values.revolut_username),
    instalments: {
      count: Number(values.instalments_count),
      interval: values.instalments_interval,
      mode: values.instalments_mode,
      plan_lead_days: Number(values.instalments_plan_lead_days),
      plan_auto_send: values.instalments_plan_auto_send,
      reminders_enabled: values.instalments_reminders_enabled,
      remind_before_days: Number(values.instalments_remind_before_days),
      remind_after_days: afterDays(values.instalments_remind_after_days),
    },
    dunning: {
      enabled: values.dunning_enabled,
      steps: values.dunning_steps.map((step) => {
        const fee = parseDecimalInput(step.fee || '0', 2)
        // as money, "20.00": at most two decimals, so toFixed is exact
        return {
          name: orNull(step.name),
          timing: step.timing,
          days: Number(step.days),
          fee: fee === null ? step.fee : Number(fee).toFixed(2),
          text: orNull(step.text),
          qr_bill: step.qr_bill,
        }
      }),
      interest_enabled: values.dunning_interest_enabled,
      interest_rate:
        parseDecimalInput(values.dunning_interest_rate, 2) ?? values.dunning_interest_rate,
      interest_from: values.dunning_interest_from,
    },
    payment_confirmation: values.payment_confirmation,
  }
}

const whole = (typed: string, min: number, max: number) =>
  /^\d{1,3}$/.test(typed) && Number(typed) >= min && Number(typed) <= max

export function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {}
  if (values.electronic_scheme.trim() || values.electronic_id.trim()) {
    if (!/^\d{4}$/.test(values.electronic_scheme.trim()))
      errors.electronic_scheme = translate('enterTheFourDigitEASSchemeCode')
    if (!values.electronic_id.trim())
      errors.electronic_id = translate('enterTheElectronicAddressRegisteredWithYourProvider')
  }
  if (values.iban.trim() && !ibanInfo(values.iban).valid)
    errors.iban = translate('thisIBANSCheckDigitsDonTMatchCheck')
  const market = unsupportedSellerCountry(values.country)
  if (market) errors.country = market
  const rate = parseDecimalInput(values.default_vat_rate, 2)
  if (rate === null || rate.startsWith('-') || Number(rate) > 100)
    errors.default_vat_rate = translate('aRateFrom0To100')
  const days = Number(values.default_terms_days)
  if (!/^\d{1,3}$/.test(values.default_terms_days) || days > 365)
    errors.default_terms_days = translate('from0To365Days')
  const numberFormat = numberFormatError(values.number_format)
  if (numberFormat) errors.number_format = numberFormat
  if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
    errors.email = translate('checkTheEmailAddress')
  if (values.website.trim() && !validWebsite(values.website))
    errors.website = translate('enterAWebsiteSuchAsMusterCh')
  if (values.phone.trim() && !toE164(values.phone, values.phone_country)) errors.phone = PHONE_ERROR
  if (values.revolut_username.trim() && !revolutUsername(values.revolut_username))
    errors.revolut_username = translate('message3To32LettersDigitsDotsDashesOrUnderscores')
  else if (values.revolut_enabled && !values.revolut_username.trim())
    errors.revolut_username = translate('enterYourRevolutMeUsernameToOfferRevolut')
  if (!whole(values.instalments_count, 2, 12)) errors.instalments_count = translate('from2To122')
  if (!whole(values.instalments_plan_lead_days, 0, 60))
    errors.instalments_plan_lead_days = translate('from0To60Days')
  if (!whole(values.instalments_remind_before_days, 0, 30))
    errors.instalments_remind_before_days = translate('from0To30Days')
  const after = values.instalments_remind_after_days.split(/[\s,;]+/).filter(Boolean)
  if (
    after.some((day) => !whole(day, 1, 90)) ||
    afterDays(values.instalments_remind_after_days).length > 3
  )
    errors.instalments_remind_after_days = translate('upToThreeDaysFrom1To90E')
  const timing = timingProblems(values.dunning_steps)
  values.dunning_steps.forEach((step, i) => {
    for (const [field, message] of Object.entries(stepErrors(step)))
      errors[`dunning_steps.${i}.${field}`] = message
    if (timing[i]) errors[`dunning_steps.${i}.timing`] = timing[i]
  })
  const interest = parseDecimalInput(values.dunning_interest_rate, 2)
  if (interest === null || interest.startsWith('-') || Number(interest) > 15)
    errors.dunning_interest_rate = translate('aRateFrom0To15')
  return errors
}

/** The server's 422 field names ("seller.city") as the form's fields ("city"). */
export const formField = (name: string) =>
  name === 'seller.electronic_address'
    ? 'electronic_id'
    : name
        .replace('seller.', '')
        .replace('instalments.', 'instalments_')
        .replace('dunning.', 'dunning_')

const LANGUAGE_CHOICES: { value: DocLanguage; label: string }[] = [
  { value: 'de', label: translate('deutsch') },
  { value: 'fr', label: translate('franAis') },
  { value: 'it', label: translate('italiano') },
  { value: 'en', label: translate('english') },
]

/** What issuing needs, in the contract's missing_fields order; computed live from the form. */
export function missingFrom(values: Values): string[] {
  const missing = (['name', 'street', 'street_number', 'zip', 'city', 'country'] as const)
    .filter((field) => !values[field].trim())
    .map((field) => `seller.${field}`)
  if (values.vat_registered && !values.vat_number.trim()) missing.push('seller.vat_number')
  if (!values.iban.trim()) missing.push('iban')
  return missing
}

type SectionId =
  | 'logo'
  | 'company'
  | 'einvoice'
  | 'vat'
  | 'bank'
  | 'payment'
  | 'numbering'
  | 'defaults'
  | 'instalments'
  | 'client_emails'
  | 'dunning'
  | 'footer'
export type SettingsPageId = 'company' | 'invoices'
/** Each section: its page, nav icon, the fields issuing needs (`required`) and the fields it saves. */
const SECTIONS: {
  id: SectionId
  page: SettingsPageId
  title: string
  icon: LucideIcon
  required: string[]
  fields: (keyof Values)[]
}[] = [
  {
    id: 'logo',
    page: 'company',
    title: translate('logo'),
    icon: ImageIcon,
    required: [],
    fields: [],
  },
  {
    id: 'company',
    page: 'company',
    title: translate('company'),
    icon: Building2,
    required: [
      'seller.name',
      'seller.street',
      'seller.street_number',
      'seller.zip',
      'seller.city',
      'seller.country',
    ],
    fields: [
      'name',
      'street',
      'street_number',
      'apt',
      'zip',
      'city',
      'country',
      'legal_form',
      'registration_number',
      'email',
      'phone',
      'phone_country',
      'website',
    ],
  },
  {
    id: 'vat',
    page: 'company',
    title: translate('vat'),
    icon: Percent,
    required: ['seller.vat_number'],
    fields: ['vat_registered', 'vat_number', 'default_vat_mode', 'default_vat_rate'],
  },
  {
    id: 'einvoice',
    page: 'invoices',
    title: translate('eInvoices'),
    icon: FileCode,
    required: ['seller.electronic_address'],
    fields: ['electronic_scheme', 'electronic_id'],
  },
  {
    id: 'bank',
    page: 'company',
    title: translate('bankAccount'),
    icon: Landmark,
    required: ['iban'],
    fields: ['iban', 'bank_name', 'bic'],
  },
  // Not needed to issue: incomplete only while Revolut is on without a username.
  {
    id: 'payment',
    page: 'invoices',
    title: translate('paymentMethods'),
    icon: CreditCard,
    required: ['revolut_username'],
    fields: ['qr_bill_enabled', 'revolut_enabled', 'revolut_username'],
  },
  {
    id: 'numbering',
    page: 'invoices',
    title: translate('numbering'),
    icon: Hash,
    required: [],
    fields: ['number_format'],
  },
  {
    id: 'defaults',
    page: 'invoices',
    title: translate('defaults'),
    icon: SlidersHorizontal,
    required: [],
    fields: ['currency', 'language', 'default_terms_days'],
  },
  {
    id: 'instalments',
    page: 'invoices',
    title: translate('instalments2'),
    icon: CalendarRange,
    required: [],
    fields: [
      'instalments_count',
      'instalments_interval',
      'instalments_mode',
      'instalments_plan_lead_days',
      'instalments_plan_auto_send',
      'instalments_reminders_enabled',
      'instalments_remind_before_days',
      'instalments_remind_after_days',
    ],
  },
  {
    id: 'client_emails',
    page: 'invoices',
    title: translate('clientEmails'),
    icon: MailCheck,
    required: [],
    fields: ['payment_confirmation'],
  },
  {
    id: 'dunning',
    page: 'invoices',
    title: translate('dunning'),
    icon: BellRing,
    required: [],
    fields: [
      'dunning_enabled',
      'dunning_steps',
      'dunning_interest_enabled',
      'dunning_interest_rate',
      'dunning_interest_from',
    ],
  },
  {
    id: 'footer',
    page: 'invoices',
    title: translate('footer'),
    icon: PanelBottom,
    required: [],
    fields: ['footer'],
  },
]
const SAVED_SECTIONS = SECTIONS.filter((section) => section.fields.length > 0)
const sectionById = (id: SectionId) => SECTIONS.find((section) => section.id === id)

/** Settings → Company: who the business is, used on every document. */
export function CompanySettingsPage() {
  return <SettingsPageFor page="company" />
}

/** Settings → Invoices: how invoices are numbered, paid, reminded and printed. */
export function InvoiceSettingsPage() {
  return <SettingsPageFor page="invoices" />
}

function SettingsPageFor({ page }: { page: SettingsPageId }) {
  const settings = useInvoiceSettings()
  if (settings.data) return <SettingsForm settings={settings.data} page={page} />
  return (
    <>
      <SettingsHeader />
      <div className="flex-1">
        {settings.error ? (
          <State
            icon={<CloudOff />}
            title={translate('couldnTLoadTheInvoiceSettings')}
            text={errorMessage(settings.error)}
            action={
              <Button variant="outline" size="sm" onClick={() => void settings.refetch()}>
                {translate('tryAgain')}
              </Button>
            }
          />
        ) : (
          <Loader size="page" className="min-h-96" />
        )}
      </div>
    </>
  )
}

/** One block of settings, with its nav icon; `data-section` is what the scroll spy watches. */
function Section({
  id,
  title,
  description,
  state,
  children,
}: {
  id: SectionId
  title: string
  description: string
  state?: SectionState
  children: ReactNode
}) {
  return (
    <SettingsSection
      id={`section-${id}`}
      data-section={id}
      icon={sectionById(id)?.icon}
      title={title}
      description={description}
      section={state}
    >
      {children}
    </SettingsSection>
  )
}

/** What being unregistered means for invoices, and what registering will ask for. */
function VatOffNote() {
  return (
    <div
      aria-label={translate('notRegisteredForVAT')}
      role="note"
      className="grid gap-4 rounded-xl bg-muted/50 px-4 py-3.5 text-body-sm leading-relaxed text-foreground sm:grid-cols-2 sm:gap-8"
    >
      <div className="grid content-start gap-1">
        <p className="font-medium">{translate('whileItIsOff')}</p>
        <ul className="grid list-disc gap-0.5 pl-4.5 marker:text-muted-foreground">
          <li>{translate('invoicesCarryNoVATThePricesAreTheTotals')}</li>
          <li>{translate('eachInvoiceNotesThatYouAreNotVATRegistered')}</li>
        </ul>
      </div>
      <div className="grid content-start gap-1">
        <p className="font-medium">{translate('turningItOnAsksFor')}</p>
        <ul className="grid list-disc gap-0.5 pl-4.5 marker:text-muted-foreground">
          <li>{translate('yourUIDWithMWSTEGCHE123456')}</li>
          <li>{translate('whetherPricesIncludeVATAndYourUsualRate8')}</li>
        </ul>
      </div>
    </div>
  )
}

/** What kind of IBAN was entered, and the payment reference its invoices get. */
function IbanNote({ iban }: { iban: Extract<IbanInfo, { valid: true }> }) {
  if (iban.qr)
    return (
      <Callout tone="success" icon={QrCode} title={translate('qrIBAN')}>
        {translate('chfInvoicesGetA27DigitQRReferenceYour')}
      </Callout>
    )
  if (iban.swiss)
    return (
      <Callout tone="info" icon={Landmark} title={translate('swissIBAN')}>
        {translate('invoicesGetAnRFCreditorReferenceAskYourBank')}
      </Callout>
    )
  return (
    <Callout tone="neutral" icon={Globe} title={translate('ibanFrom', { country: iban.country })}>
      {translate('bankDetailsArePrintedSwissQRBillsNeedA')}
    </Callout>
  )
}

/** Opens a payment link in a new tab, from the end of its input, so it can be tried before saving. */
function TestLink({ href }: { href: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        >
          <a
            href={localizedHref(href)}
            target="_blank"
            rel="noreferrer"
            aria-label={translate('testTheLink2')}
          >
            <ExternalLink />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {translate('testTheLink')}
        {href.replace('https://', '')}
      </TooltipContent>
    </Tooltip>
  )
}

/** The section in view while scrolling, for the nav. */
function useSectionInView(first: SectionId) {
  const [active, setActive] = useState<SectionId>(first)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        const top = visible.toSorted(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        )[0]
        const id = top?.target.getAttribute('data-section')
        const section = SECTIONS.find((entry) => entry.id === id)
        if (section) setActive(section.id)
      },
      { rootMargin: '-80px 0px -55% 0px' },
    )
    for (const element of document.querySelectorAll('[data-section]')) observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [active, setActive] as const
}

/** The API's reason the base currency cannot change any more (409 currency_locked), else null. */
export const currencyLock = (error: unknown) =>
  error instanceof ApiError && error.code === 'currency_locked' ? error.message : null

const ONES = { year: 1, ever: 1 }
/** Until the counters are read, and when they cannot be: every series starts at 1. */
const FIRST_NUMBERS: NextNumbers = {
  series: { invoice: ONES, credit_note: ONES, proforma: ONES, self_billed: ONES },
  quote: 1,
  contract: 1,
}

/** Every document type the number format numbers. */
const NEXT_NUMBER_KINDS: { kind: NumberedKind; label: () => string }[] = [
  { kind: 'invoice', label: () => translate('invoice2') },
  { kind: 'quote', label: () => translate('quote2') },
  { kind: 'contract', label: () => translate('contract') },
  { kind: 'credit_note', label: () => translate('creditNote2') },
  { kind: 'debit_note', label: () => translate('debitNote2') },
  { kind: 'prepayment', label: () => translate('prepayment').trim() },
  { kind: 'proforma', label: () => translate('proforma') },
  { kind: 'corrected', label: () => translate('correctedInvoice') },
  { kind: 'self_billed', label: () => translate('selfBilled') },
]

const bigInput = cn(inputClass, 'placeholder:text-placeholder')

function SettingsForm({ settings, page }: { settings: InvoiceSettings; page: SettingsPageId }) {
  const sections = SECTIONS.filter((section) => section.page === page)
  const shows = (id: SectionId) => sections.some((section) => section.id === id)
  const router = useRouter()
  const canEdit = useCan('write:invoice-settings')
  const remindersLock = useFeatureLock('automations')
  const save = useSaveInvoiceSettings()
  const legalForms = useLegalForms().data
  const nextNumbers =
    useQuery({
      queryKey: [...invoiceKeys.settings, 'next-numbers'],
      queryFn: invoicesApi.nextNumbers,
    }).data ?? FIRST_NUMBERS
  // The API has no flag to read up front: the first refused change locks the field.
  const [currencyLocked, setCurrencyLocked] = useState<string | null>(null)
  const form = useSectionForm({
    initial: valuesFrom(settings),
    sections: SAVED_SECTIONS.filter((section) => section.page === page),
    validate,
    save: (next) =>
      save.mutateAsync(toSettingsInput(next)).catch((error: unknown) => {
        const locked = currencyLock(error)
        if (locked) setCurrencyLocked(locked)
        throw error
      }),
    fieldErrors: (error) => apiFieldErrors(error, formField),
    savedMessage: (id) => `${sectionById(id)?.title ?? translate('settings')} saved.`,
  })
  const { values, errors: shown } = form
  const [customRate, setCustomRate] = useState(
    () => !(VAT_RATES as readonly string[]).includes(values.default_vat_rate),
  )
  const [customTerms, setCustomTerms] = useState(
    () => !TERM_PRESETS.includes(values.default_terms_days),
  )
  const [active, setActive] = useSectionInView(sections[0]?.id ?? 'logo')
  const iban = ibanInfo(values.iban)
  const formOptions = legalFormOptions(legalForms, values.country)

  // What issuing needs, from what is saved: unsaved edits don't make invoices issuable yet.
  const missing = missingFrom(form.saved)
  const required = form.saved.vat_registered ? 8 : 7
  const done = required - missing.length

  const set = form.set
  const describe = (field: keyof Values) => describedBy(inputId(field), shown[field])
  const state = (id: SectionId) => (canEdit ? form.section(id) : undefined)

  const focus = (field: string) => {
    const element = document.getElementById(inputId(field.replace('seller.', '')))
    // A field on the other settings page: open it there.
    if (!element) return router.push(settingsFix(field).href)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element?.focus({ preventScroll: true })
  }
  const goTo = (id: SectionId) => {
    setActive(id)
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // A fix link from a refused issue lands on its section (#vat) and the field to fix (?focus=seller.zip).
  const focusFromLink = useEffectEvent(() => {
    const section = sections.find((entry) => `#${entry.id}` === window.location.hash)
    if (section) setActive(section.id)
    const field = new URLSearchParams(window.location.search).get('focus')
    if (field) focus(field)
    else if (section) goTo(section.id)
  })
  useEffect(() => {
    const timer = setTimeout(focusFromLink, 150)
    return () => clearTimeout(timer)
  }, [])

  const sectionMissing = (id: SectionId) =>
    id === 'payment'
      ? Boolean(validate(form.saved).revolut_username)
      : sectionById(id)?.required.some((field) => missing.includes(field))
  const revolutName = revolutUsername(values.revolut_username)

  return (
    <>
      <SettingsHeader
        actions={
          canEdit ? undefined : (
            <span className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
              <Lock className="size-3.5" />
              {translate('viewOnlyAskAnOwnerOrAdminForEditAccess')}
            </span>
          )
        }
      />
      <SettingsPage
        title={page === 'company' ? translate('company') : translate('invoiceSettings')}
        description={
          page === 'company'
            ? translate('companySettingsDescription')
            : translate('invoiceSettingsDescription')
        }
        nav={sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={active === section.id ? 'true' : undefined}
            onClick={() => goTo(section.id)}
            className="flex h-8 items-center justify-between gap-2 rounded-md px-3 text-left text-body-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=true]:font-medium aria-[current=true]:text-foreground"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{section.title}</span>
              {form.dirtySections.includes(section.id) && (
                <span className="flex" title={translate('unsavedChanges3')}>
                  <UnsavedDot />
                  <span className="sr-only">{translate('unsavedChanges3')}</span>
                </span>
              )}
            </span>
            {section.required.length > 0 &&
              (sectionMissing(section.id) ? (
                <span
                  aria-label={translate('incomplete')}
                  className="size-2 rounded-full bg-warning-solid ring-2 ring-warning-solid/15"
                />
              ) : (
                <Check aria-label={translate('complete')} className="size-3.5 text-success-solid" />
              ))}
          </button>
        ))}
      >
        <div className="grid min-w-0 content-start gap-5">
          {/* Phones and tablets: the sections as a scrolling row. */}
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 @4xl:hidden">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={active === section.id ? 'true' : undefined}
                onClick={() => goTo(section.id)}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-body-sm text-muted-foreground ring-1 ring-border transition-colors ring-inset hover:text-foreground aria-[current=true]:bg-muted aria-[current=true]:font-medium aria-[current=true]:text-foreground"
              >
                {section.title}
                {form.dirtySections.includes(section.id) && (
                  <>
                    <UnsavedDot />
                    <span className="sr-only">{translate('unsavedChanges2')}</span>
                  </>
                )}
              </button>
            ))}
          </div>

          <SettingsNotice>
            <Readiness done={done} total={required} missing={missing} onFix={focus} />
          </SettingsNotice>

          <fieldset disabled={!canEdit} className="grid min-w-0 gap-5">
            {shows('logo') && (
              <Section
                id="logo"
                title={translate('logo')}
                description={translate('topLeftOnEveryInvoiceAndCreditNoteAbove')}
              >
                <LogoDropzone url={logoSrc(settings)} canEdit={canEdit} />
              </Section>
            )}

            {shows('company') && (
              <Section
                id="company"
                state={state('company')}
                title={translate('company')}
                description={translate('theSellerBlockOnEveryInvoiceSwissQRBills')}
              >
                <FormField
                  id={inputId('name')}
                  label={translate('companyName')}
                  required
                  error={shown.name}
                >
                  <input
                    {...describe('name')}
                    value={values.name}
                    maxLength={70}
                    autoComplete="organization"
                    onChange={(e) => set('name', e.target.value)}
                    placeholder={translate('eGMusterAG')}
                    className={bigInput}
                  />
                </FormField>
                <FormField
                  id={inputId('legal_form')}
                  label={translate('legalForm')}
                  width="md"
                  error={shown.legal_form}
                  tip={translate('legalFormTip')}
                >
                  <Combobox
                    id={inputId('legal_form')}
                    value={values.legal_form}
                    options={formOptions}
                    disabled={formOptions.length === 0}
                    invalid={Boolean(shown.legal_form)}
                    placeholder={
                      legalForms && formOptions.length === 0
                        ? translate('noLegalFormsForThisCountryYet')
                        : translate('chooseALegalForm')
                    }
                    onChange={(code) => set('legal_form', code)}
                  />
                </FormField>
                <FormField
                  id={inputId('registration_number')}
                  label={translate('businessRegistrationNumber')}
                  width="md"
                  error={shown.registration_number}
                  tip={translate('theLegalRegistrationNumberSeparatelyFromVATRequiredFor')}
                >
                  <input
                    {...describe('registration_number')}
                    value={values.registration_number}
                    maxLength={100}
                    onChange={(event) => set('registration_number', event.target.value)}
                    placeholder={translate('eGCHE123456789')}
                    className={bigInput}
                  />
                </FormField>
                <FormField
                  id={inputId('street')}
                  label={translate('street')}
                  required
                  error={shown.street}
                  width="md"
                >
                  <input
                    {...describe('street')}
                    value={values.street}
                    maxLength={70}
                    autoComplete="address-line1"
                    onChange={(e) => set('street', e.target.value)}
                    placeholder={translate('eGBahnhofstrasse')}
                    className={bigInput}
                  />
                </FormField>
                <FormField
                  id={inputId('street_number')}
                  label={translate('number')}
                  width="xs"
                  required
                  error={shown.street_number}
                >
                  <input
                    {...describe('street_number')}
                    value={values.street_number}
                    maxLength={16}
                    onChange={(e) => set('street_number', e.target.value)}
                    placeholder={translate('eG1')}
                    className={bigInput}
                  />
                </FormField>
                <FormField
                  id={inputId('apt')}
                  label={translate('aptSuite')}
                  error={shown.apt}
                  width="xs"
                >
                  <input
                    {...describe('apt')}
                    value={values.apt}
                    autoComplete="address-line2"
                    onChange={(e) => set('apt', e.target.value)}
                    placeholder={translate('optional')}
                    className={bigInput}
                  />
                </FormField>
                <FormField id={inputId('zip')} label="ZIP" required error={shown.zip} width="xs">
                  <input
                    {...describe('zip')}
                    value={values.zip}
                    maxLength={16}
                    autoComplete="postal-code"
                    onChange={(e) => set('zip', e.target.value)}
                    placeholder={translate('eG8001')}
                    className={bigInput}
                  />
                </FormField>
                <FormField
                  id={inputId('city')}
                  label={translate('city')}
                  required
                  error={shown.city}
                  width="xs"
                >
                  <input
                    {...describe('city')}
                    value={values.city}
                    maxLength={35}
                    autoComplete="address-level2"
                    onChange={(e) => set('city', e.target.value)}
                    placeholder={translate('eGZRich')}
                    className={bigInput}
                  />
                </FormField>
                <FormField
                  id={inputId('country')}
                  label={translate('country')}
                  required
                  error={shown.country}
                  width="md"
                >
                  <Combobox
                    id={inputId('country')}
                    value={values.country}
                    options={COUNTRY_OPTIONS}
                    invalid={Boolean(shown.country)}
                    placeholder={translate('chooseACountry2')}

                    onChange={(code) => {
                      set('country', code)
                      // Another country's forms differ: suggest from the name, or leave it to choose.
                      set('legal_form', suggestLegalForm(legalForms, code, values.name) ?? '')
                    }}
                  />
                </FormField>
                <>
                  <FormField
                    id={inputId('email')}
                    label={translate('email')}
                    width="md"
                    error={shown.email}
                    tip={translate('printedOnInvoicesAndTheReplyToAddressWhen')}
                  >
                    <input
                      {...describe('email')}
                      type="email"
                      value={values.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder={translate('eGBillingMusterCh')}
                      className={bigInput}
                    />
                  </FormField>
                  <FormField
                    id={inputId('phone')}
                    label={translate('phone')}
                    error={shown.phone}
                    width="md"
                  >
                    <PhoneInput
                      {...describe('phone')}
                      value={values.phone}
                      country={values.phone_country}
                      invalid={Boolean(shown.phone)}
                      onChange={(phone) => set('phone', phone)}
                      onCountryChange={(code) => set('phone_country', phoneCountryOr(code))}
                    />
                  </FormField>
                  <FormField
                    id={inputId('website')}
                    label={translate('website')}
                    width="md"
                    error={shown.website}
                  >
                    <input
                      {...describe('website')}
                      type="text"
                      inputMode="url"
                      value={values.website}
                      onChange={(e) => set('website', e.target.value)}
                      placeholder={translate('eGMusterCh')}
                      className={bigInput}
                    />
                  </FormField>
                </>
              </Section>
            )}

            {shows('einvoice') && (
              <Section
                id="einvoice"
                state={state('einvoice')}
                title={translate('electronicInvoicing')}
                description={translate('useTheElectronicAddressRegisteredWithYourProviderXML')}
              >
                <>
                  <FormField
                    id={inputId('electronic_scheme')}
                    label={translate('eInvoiceAddressScheme')}
                    width="sm"
                    error={shown.electronic_scheme}
                    tip={translate('easCodeForExample0088ForGLNOr0204')}
                  >
                    <input
                      {...describe('electronic_scheme')}
                      value={values.electronic_scheme}
                      maxLength={4}
                      onChange={(event) => set('electronic_scheme', event.target.value)}
                      placeholder={translate('eG0088')}
                      className={bigInput}
                    />
                  </FormField>
                  <FormField
                    id={inputId('electronic_id')}
                    label={translate('eInvoiceElectronicAddress')}
                    width="lg"
                    error={shown.electronic_id}
                  >
                    <input
                      {...describe('electronic_id')}
                      value={values.electronic_id}
                      maxLength={200}
                      onChange={(event) => set('electronic_id', event.target.value)}
                      placeholder={translate('eG7612345678900')}
                      className={bigInput}
                    />
                  </FormField>
                </>
              </Section>
            )}

            {shows('vat') && (
              <Section
                id="vat"
                state={state('vat')}
                title={translate('vat')}
                description={translate('registeredBusinessesPrintTheirUIDWithMWSTAndA')}
              >
                <SwitchRow
                  id="settings-vat-registered"
                  label={translate('registeredForVAT')}
                  description={
                    values.vat_registered
                      ? translate('invoicesShowYourUIDAndAddVATPerRate')
                      : translate('turnOnOnceTheESTVHasRegisteredYourBusiness')
                  }
                  checked={values.vat_registered}
                  onCheckedChange={(on) => set('vat_registered', on)}
                />
                {!values.vat_registered && <VatOffNote />}
                {values.vat_registered && (
                  <>
                    <FormField
                      id={inputId('vat_number')}
                      label={translate('vatNumber')}
                      width="md"
                      required
                      error={shown.vat_number}
                      tip={translate('yourUIDWithTheMWSTSuffixEGCHE')}
                    >
                      <input
                        {...describe('vat_number')}
                        value={values.vat_number}
                        onChange={(e) => set('vat_number', formatUid(e.target.value))}
                        placeholder={translate('eGCHE123456789MWST')}
                        className={cn(bigInput, 'font-code text-body')}
                      />
                    </FormField>
                    <>
                      <FormField
                        id={inputId('default_vat_mode')}
                        label={translate('pricesAreEntered')}
                        group
                      >
                        <Segmented
                          label={translate('pricesAreEntered')}
                          value={values.default_vat_mode}
                          options={[
                            { value: 'exclusive', label: translate('exclVAT') },
                            { value: 'inclusive', label: translate('inclVAT') },
                          ]}
                          onChange={(mode) => set('default_vat_mode', mode)}
                        />
                      </FormField>
                      <FormField
                        id={inputId('default_vat_rate')}
                        label={translate('defaultRate')}
                        error={shown.default_vat_rate}
                        group
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Segmented
                            label={translate('defaultRate')}
                            value={customRate ? 'custom' : values.default_vat_rate}
                            options={[
                              ...VAT_RATES.map((rate) => ({ value: rate, label: `${rate}%` })),
                              { value: 'custom', label: translate('other') },
                            ]}
                            onChange={(choice) => {
                              setCustomRate(choice === 'custom')
                              if (choice !== 'custom') set('default_vat_rate', choice)
                            }}
                          />
                          {customRate && (
                            <PercentInput
                              {...describe('default_vat_rate')}
                              aria-label={translate('otherRate')}
                              value={values.default_vat_rate}
                              onValueChange={(value) => set('default_vat_rate', value)}
                              placeholder="7.7"
                              className="w-28"
                            />
                          )}
                        </div>
                      </FormField>
                    </>
                  </>
                )}
              </Section>
            )}

            {shows('bank') && (
              <Section
                id="bank"
                state={state('bank')}
                title={translate('bankAccount')}
                description={translate('printedOnEveryInvoiceASwissIBANAddsA')}
              >
                <FormField id={inputId('iban')} label="IBAN" required error={shown.iban} width="md">
                  <input
                    {...describe('iban')}
                    value={values.iban}
                    onChange={(e) => set('iban', e.target.value.toUpperCase())}
                    onBlur={() => iban.valid && set('iban', iban.formatted)}
                    placeholder={translate('eGCH9300762011623852957')}
                    spellCheck={false}
                    className={cn(bigInput, 'font-code text-body tracking-wide')}
                  />
                </FormField>
                <FormField
                  id={inputId('bank_name')}
                  label={translate('bank')}
                  error={shown.bank_name}
                  width="md"
                >
                  <input
                    {...describe('bank_name')}
                    value={values.bank_name}
                    onChange={(e) => set('bank_name', e.target.value)}
                    placeholder={translate('eGZRcherKantonalbank')}
                    className={bigInput}
                  />
                </FormField>
                <FormField id={inputId('bic')} label="BIC / SWIFT" error={shown.bic} width="sm">
                  <input
                    {...describe('bic')}
                    value={values.bic}
                    maxLength={14}
                    onChange={(e) => set('bic', e.target.value.toUpperCase())}
                    placeholder={translate('eGZKBKCHZZ80A')}
                    spellCheck={false}
                    className={cn(bigInput, 'font-code text-body tracking-wide')}
                  />
                </FormField>
                {values.iban.trim() && iban.valid && <IbanNote iban={iban} />}
              </Section>
            )}

            {shows('payment') && (
              <Section
                id="payment"
                state={state('payment')}
                title={translate('paymentMethods')}
                description={translate('waysToPayBesidesTheBankDetailsOnEvery')}
              >
                <SwitchRow
                  id={inputId('qr_bill_enabled')}
                  label={translate('swissQRBill')}
                  description={
                    !values.iban.trim() ? (
                      <span className="text-warning">
                        {translate('addYourIBANUnderBankAccountToAttachIt')}
                      </span>
                    ) : iban.valid && !iban.swiss ? (
                      <span className="text-warning">
                        {translate('needsACHOrLIIBANYoursIsFrom')}
                        {iban.country}.
                      </span>
                    ) : (
                      translate('aPaymentSlipOnItsOwnPageOfCHF')
                    )
                  }
                  checked={values.qr_bill_enabled}
                  onCheckedChange={(on) => set('qr_bill_enabled', on)}
                />
                <SwitchRow
                  id={inputId('revolut_enabled')}
                  label={translate('revolut2')}
                  description={translate('aPayWithRevolutLinkAndQRCodeOn')}
                  checked={values.revolut_enabled}
                  onCheckedChange={(on) => {
                    form.touch('revolut_username')
                    set('revolut_enabled', on)
                  }}
                />
                {(values.revolut_enabled || values.revolut_username) && (
                  <FormField
                    id={inputId('revolut_username')}
                    label={translate('revolutMeUsername')}
                    width="md"
                    required={values.revolut_enabled}
                    error={shown.revolut_username}
                    tip={translate('yourRevtagAsInYourRevolutMeLinkPaste')}
                  >
                    <div className="relative">
                      <span
                        aria-hidden
                        className="font-code pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-body text-muted-foreground"
                      >
                        {translate('revolutMe')}
                      </span>
                      <input
                        {...describe('revolut_username')}
                        value={values.revolut_username}
                        maxLength={100}
                        spellCheck={false}
                        autoCapitalize="none"
                        onChange={(e) => set('revolut_username', e.target.value)}
                        onBlur={() => revolutName && set('revolut_username', revolutName)}
                        placeholder={translate('yourname')}
                        className={cn(
                          bigInput,
                          'font-code pl-[104px] text-body',
                          revolutName && 'pr-11',
                        )}
                      />
                      {revolutName && <TestLink href={revolutLink(revolutName)} />}
                    </div>
                  </FormField>
                )}
              </Section>
            )}

            {shows('numbering') && (
              <Section
                id="numbering"
                state={state('numbering')}
                title={translate('numbering')}
                description={translate('numbersAreGivenWhenAnInvoiceIsIssuedWithout')}
              >
                <FormField
                  id={inputId('number_format')}
                  label={translate('numberFormat')}
                  error={shown.number_format}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <NumberFormatField
                        id={inputId('number_format')}
                        country={values.country}
                        value={values.number_format}
                        invalid={Boolean(shown.number_format)}
                        onChange={(format) => set('number_format', format)}
                      />
                    </div>
                    <span className="flex h-9 items-center">
                      <NextNumbersTip
                        items={NEXT_NUMBER_KINDS.map(({ kind, label }) => ({
                          label: label(),
                          value: nextNumberOf(values.number_format, today(), kind, nextNumbers),
                        }))}
                      />
                    </span>
                  </div>
                </FormField>
                <ApprovalsRow currency={values.currency} />
              </Section>
            )}

            {shows('defaults') && (
              <Section
                id="defaults"
                state={state('defaults')}
                title={translate('defaults')}
                description={translate('whatANewInvoiceStartsWithAClientS')}
              >
                <>
                  <FormField
                    id={inputId('currency')}
                    label={translate('currency')}
                    width="md"
                    error={shown.currency}
                    status={currencyLocked ?? undefined}
                  >
                    <fieldset disabled={Boolean(currencyLocked)} className="contents">
                      <Combobox
                        id={inputId('currency')}
                        value={values.currency}
                        options={CURRENCY_OPTIONS}
                        renderValue={(option) => `${option.value} · ${option.label}`}
                        placeholder={translate('chooseACurrency2')}
                        onChange={(code) => set('currency', code)}
                      />
                    </fieldset>
                  </FormField>
                  <FormField id={inputId('language')} label={translate('documentLanguage')} group>
                    <Segmented
                      label={translate('documentLanguage')}
                      value={values.language}
                      options={LANGUAGE_CHOICES}
                      onChange={(language) => set('language', language)}
                    />
                  </FormField>
                </>
                <FormField
                  id={inputId('default_terms_days')}
                  label={translate('paymentTerms')}
                  error={shown.default_terms_days}
                  group
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      label={translate('paymentTerms')}
                      value={customTerms ? 'custom' : values.default_terms_days}
                      options={[
                        ...TERM_PRESETS.map((days) => ({
                          value: days,
                          label: translate('days3', { days: days }),
                        })),
                        { value: 'custom', label: translate('custom') },
                      ]}
                      onChange={(choice) => {
                        setCustomTerms(choice === 'custom')
                        if (choice !== 'custom') set('default_terms_days', choice)
                      }}
                    />
                    {customTerms && (
                      <UnitInput
                        {...describe('default_terms_days')}
                        aria-label={translate('customPaymentTerms')}
                        unit="days"
                        inputMode="numeric"
                        value={values.default_terms_days}
                        onChange={(e) =>
                          set('default_terms_days', e.target.value.replace(/\D/g, '').slice(0, 3))
                        }
                        placeholder="45"
                        className="w-28"
                      />
                    )}
                  </div>
                </FormField>
              </Section>
            )}

            {shows('instalments') && (
              <Section
                id="instalments"
                state={state('instalments')}
                title={translate('instalments2')}
                description={translate('howAnInvoicePaidInPartsStartsAndThe')}
              >
                <FormField
                  id={inputId('instalments_mode')}
                  label={translate('payInInstalmentsAs')}
                  group
                >
                  <Segmented
                    fill
                    label={translate('payInInstalmentsAs')}
                    value={values.instalments_mode}
                    options={[
                      { value: 'schedule', label: translate('oneInvoiceSeveralDueDates') },
                      { value: 'plan', label: translate('oneInvoicePerInstalment') },
                    ]}
                    onChange={(mode) => set('instalments_mode', mode)}
                  />
                </FormField>
                <FormField
                  id={inputId('instalments_count')}
                  label={translate('instalments2')}
                  width="xs"
                  error={shown.instalments_count}
                >
                  <input
                    {...describe('instalments_count')}
                    inputMode="numeric"
                    value={values.instalments_count}
                    onChange={(e) =>
                      set('instalments_count', e.target.value.replace(/\D/g, '').slice(0, 2))
                    }
                    className={cn(bigInput, 'tabular-nums')}
                  />
                </FormField>
                <FormField
                  id={inputId('instalments_interval')}
                  label={translate('every')}
                  width="xs"
                >
                  <NativeSelect
                    id={inputId('instalments_interval')}
                    value={values.instalments_interval}
                    onChange={(e) => {
                      const picked = INTERVALS.find((entry) => entry.value === e.target.value)
                      if (picked) set('instalments_interval', picked.value)
                    }}
                  >
                    {INTERVALS.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField
                  id={inputId('instalments_plan_lead_days')}
                  label={translate('issueInvoices')}
                  width="md"
                  error={shown.instalments_plan_lead_days}
                  tip={translate('forOneInvoicePerInstalmentHowManyDaysBefore')}
                >
                  <UnitInput
                    {...describe('instalments_plan_lead_days')}
                    unit={translate('daysBeforeDue')}
                    inputMode="numeric"
                    value={values.instalments_plan_lead_days}
                    onChange={(e) =>
                      set(
                        'instalments_plan_lead_days',
                        e.target.value.replace(/\D/g, '').slice(0, 2),
                      )
                    }
                  />
                </FormField>
                <SwitchRow
                  id={inputId('instalments_plan_auto_send')}
                  label={translate('emailInstalmentInvoicesWhenIssued')}
                  description={translate('sentToTheClientSBillingEmailWithoutOne')}
                  checked={values.instalments_plan_auto_send}
                  onCheckedChange={(on) => set('instalments_plan_auto_send', on)}
                />
                <SwitchRow
                  id={inputId('instalments_reminders_enabled')}
                  label={translate('paymentReminders')}
                  description={translate('emailsTheClientBeforeAndAfterEachInstalmentIs')}
                  checked={values.instalments_reminders_enabled}
                  onCheckedChange={(on) => set('instalments_reminders_enabled', on)}
                />
                {values.instalments_reminders_enabled && (
                  <>
                    <FormField
                      id={inputId('instalments_remind_before_days')}
                      label={translate('beforeTheDueDate')}
                      width="md"
                      error={shown.instalments_remind_before_days}
                      tip={translate('aFriendlyHeadsUpBeforeTheInstalmentIsDue')}
                    >
                      <UnitInput
                        {...describe('instalments_remind_before_days')}
                        unit={translate('daysBefore')}
                        inputMode="numeric"
                        value={values.instalments_remind_before_days}
                        onChange={(e) =>
                          set(
                            'instalments_remind_before_days',
                            e.target.value.replace(/\D/g, '').slice(0, 2),
                          )
                        }
                      />
                    </FormField>
                    <FormField
                      id={inputId('instalments_remind_after_days')}
                      label={translate('afterTheDueDateIfUnpaid')}
                      width="md"
                      error={shown.instalments_remind_after_days}
                      tip={translate('upToThreeRemindersSeparatedByCommas310')}
                    >
                      <UnitInput
                        {...describe('instalments_remind_after_days')}
                        unit={translate('daysAfter')}
                        value={values.instalments_remind_after_days}
                        onChange={(e) => set('instalments_remind_after_days', e.target.value)}
                        placeholder="3, 10"
                      />
                    </FormField>
                    <SettingsPreview label={translate('reminderSchedule')}>
                      {reminderSummary(
                        values.instalments_remind_before_days,
                        values.instalments_remind_after_days,
                      )}
                    </SettingsPreview>
                  </>
                )}
              </Section>
            )}

            {shows('client_emails') && (
              <Section
                id="client_emails"
                state={state('client_emails')}
                title={translate('clientEmails')}
                description={translate('clientEmailsDescription')}
              >
                <SwitchRow
                  id={inputId('payment_confirmation')}
                  label={translate('emailClientsAPaymentConfirmation')}
                  description={translate('emailClientsAPaymentConfirmationHelp')}
                  checked={values.payment_confirmation}
                  onCheckedChange={(on) => set('payment_confirmation', on)}
                />
              </Section>
            )}

            {shows('dunning') && (
              <Section
                id="dunning"
                state={state('dunning')}
                title={translate('dunning')}
                description={translate('remindersForInvoicesWithoutInstalmentsInUpToTen')}
              >
                <SwitchRow
                  id={inputId('dunning_enabled')}
                  label={translate('sendRemindersAutomatically')}
                  description={translate('eachStepGoesOutOnceToTheClientS')}
                  disabledReason={
                    remindersLock && !values.dunning_enabled ? `${remindersLock.hint}.` : undefined
                  }
                  checked={values.dunning_enabled}
                  onCheckedChange={(on) => set('dunning_enabled', on)}
                />
                <DunningSteps
                  steps={values.dunning_steps}
                  currency={values.currency}
                  errors={shown}
                  onChange={(steps) => set('dunning_steps', steps)}
                />
                <SwitchRow
                  id={inputId('dunning_interest_enabled')}
                  label={translate('defaultInterest')}
                  description={translate('simpleInterestOnTheOpenAmountShownOnEach')}
                  checked={values.dunning_interest_enabled}
                  onCheckedChange={(on) => set('dunning_interest_enabled', on)}
                />
                {values.dunning_interest_enabled && (
                  <>
                    <FormField
                      id={inputId('dunning_interest_rate')}
                      label={translate('rate2')}
                      width="xs"
                      error={shown.dunning_interest_rate}
                      tip={translate('message5AYearIsTheStatutoryRateAHigher')}
                    >
                      <PercentInput
                        {...describe('dunning_interest_rate')}
                        unit={translate('aYear3')}
                        value={values.dunning_interest_rate}
                        onValueChange={(value) => set('dunning_interest_rate', value)}
                      />
                    </FormField>
                    <FormField
                      id={inputId('dunning_interest_from')}
                      label={translate('interestRunsFrom')}
                      hint={translate('fromTheDueDateOnlyWhenItWasAgreed')}
                      group
                    >
                      <Segmented
                        label={translate('interestRunsFrom')}
                        value={values.dunning_interest_from}
                        options={[
                          { value: 'reminder', label: translate('theFirstReminder') },
                          { value: 'due_date', label: translate('theDueDate') },
                        ]}
                        onChange={(from) => set('dunning_interest_from', from)}
                      />
                    </FormField>
                  </>
                )}
              </Section>
            )}

            {shows('footer') && (
              <Section
                id="footer"
                state={state('footer')}
                title={translate('footer')}
                description={translate('printedUnderTheTotalsOfEveryNewInvoiceEach')}
              >
                <FormField
                  id={inputId('footer')}
                  label={translate('footerText')}
                  error={shown.footer}
                >
                  <TextareaBox
                    {...describe('footer')}
                    rows={3}
                    maxLength={DOCUMENT_TEXT_MAX}
                    value={values.footer}
                    onChange={(e) => set('footer', e.target.value)}
                    placeholder={translate('eGThankYouForYourTrustPayableWithin')}
                    max={DOCUMENT_TEXT_MAX}
                    className="min-h-24 leading-relaxed"
                  />
                </FormField>
              </Section>
            )}
          </fieldset>
        </div>
      </SettingsPage>
    </>
  )
}

/** How far the profile is from issuing, and the shortest way to finish it. */
function Readiness({
  done,
  total,
  missing,
  onFix,
}: {
  done: number
  total: number
  missing: string[]
  onFix: (field: string) => void
}) {
  if (missing.length === 0)
    return (
      <p className="flex items-center gap-2.5 rounded-xl bg-success-surface px-4 py-3 text-body text-success ring-1 ring-success-solid/20 sm:px-5">
        <CircleCheck className="size-4" /> <span className="font-medium">{translate('ready')}</span>
        {translate('invoicesCanBeIssuedWithTheseDetails')}
      </p>
    )
  return (
    <div className="grid gap-3 rounded-xl border bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-title-sm font-semibold tracking-[-0.01em]">
          {translate('readyToIssueInvoices')}
        </p>
        <p className="text-body-sm text-muted-foreground tabular-nums">
          {done}
          {translate('of5')}
          {total}
          {translate('done3')}
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-success-solid transition-[width] duration-500"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <p className="flex flex-wrap gap-x-1 text-body-sm text-muted-foreground">
        {translate('stillNeeded')}
        {missing.map((field, i) => (
          <span key={field}>
            <button
              type="button"
              onClick={() => onFix(field)}
              className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              {MISSING_LABELS[field] ?? field}
            </button>
            {i < missing.length - 1 && ','}
          </span>
        ))}
      </p>
    </div>
  )
}
