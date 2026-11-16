'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { HeidiOrb, HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@helvetly/ui/components/input-group'
import { Kbd } from '@helvetly/ui/components/kbd'
import { Logo } from '@helvetly/ui/components/logo'
import { Segmented } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { ThemeToggle } from '@helvetly/ui/components/theme-toggle'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDashed,
  FileUp,
  FolderOpen,
  PartyPopper,
  ReceiptText,
  UserPlus,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { LoginShowcase } from '@/components/auth/login-showcase'
import {
  Combobox,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  inputClass,
} from '@/components/clients/fields'
import { useHeidi } from '@/components/heidi/heidi-provider'
import { api, ApiError, errorMessage, type Session } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  ibanInfo,
  logoSrc,
  MISSING_LABELS,
  useInvoiceSettings,
  useSaveInvoiceSettings,
  type DocLanguage,
  type InvoiceSettings,
  unsupportedSellerCountry,
} from '@/lib/invoices'
import { queryKeys, useSession } from '@/lib/queries'
import { safeNextPath } from '@/lib/safe'
import { useUpdateWorkspace } from '@/lib/workspaces'

import { InvoicePreview } from './invoice-preview'
import { LogoCard } from './logo-card'
import {
  fieldErrors,
  toSettingsInput,
  uidDigits,
  validate,
  valuesFrom,
  vatSuffix,
  type Values,
} from './onboarding-model'

type StepId = 'welcome' | 'company' | 'logo' | 'preferences' | 'done'
type Errors = Partial<Record<string, string>>

const LANGUAGES: { value: DocLanguage; label: string }[] = [
  { value: 'de', label: translate('deutsch') },
  { value: 'fr', label: translate('franAis') },
  { value: 'it', label: translate('italiano') },
  { value: 'en', label: translate('english') },
]

/** What sign-up calls a new workspace (apps/api/internal/auth/signin.go). */
const DEFAULT_WORKSPACE_NAME = 'My workspace'

/** A name worth greeting someone with: never an email address. */
const firstName = (name: string) => (name.includes('@') ? '' : (name.trim().split(/\s+/)[0] ?? ''))

/** The /welcome page; the signed-in layout has the session by now. */
export function Welcome() {
  const session = useSession().data
  return session ? <WelcomePage session={session} /> : null
}

/**
 * The welcome at /welcome: a full-screen page shown once per new workspace, the
 * steps on the left, a live invoice on the right. There is no way out but through: a step's own
 * "Skip" only moves on to the next step, except on the company step, which has none. Reaching the last step ends it for good
 * (POST /session/onboarded), and its actions go on to where the person was going. Each step saves
 * what it has before moving on, so nothing typed is lost. Only a new workspace's owner gets here
 * (GET /session's `onboarded`); invited people never do.
 */
export function WelcomePage({ session }: { session: Session }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const heidi = useHeidi()
  const steps: StepId[] = ['welcome', 'company', 'logo', 'preferences', 'done']
  const [step, setStep] = useState<StepId>('welcome')
  const index = steps.indexOf(step)
  const heading = useRef<HTMLHeadingElement>(null)
  const [chosenTarget, setTarget] = useState<string | null>(null)
  const target = chosenTarget ?? safeNextPath(searchParams.get('next'))

  const settings = useInvoiceSettings()
  const save = useSaveInvoiceSettings()
  const rename = useUpdateWorkspace()
  const [edited, setEdited] = useState<Values | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const values = edited ?? (settings.data ? valuesFrom(settings.data) : null)
  const change = (patch: Partial<Values>) => {
    if (!values) return
    setEdited({ ...values, ...patch })
    setErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key]
      return next
    })
  }

  // Ended on the server when the last step opens (a reload there must not start over); in the
  // session's cache once the person leaves, which sends them on (below).
  const finish = useMutation({ mutationFn: api.finishOnboarding })
  const done = session.onboarded

  useEffect(() => {
    if (done) router.replace(target)
  }, [done, target, router])

  /** Saves the values shown (or only what was edited, unless `always`); false when it couldn't. */
  const persist = async (always: boolean) => {
    if (!values || !settings.data || (!edited && !always)) return true
    const problems = validate(values)
    if (Object.keys(problems).length) {
      setErrors(problems)
      return false
    }
    try {
      await save.mutateAsync(toSettingsInput(settings.data, values))
      setEdited(null)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setErrors(fieldErrors(error.details))
      return false
    }
    // Sign-up names the workspace "My workspace"; the company's name is the one people expect in
    // the switcher. Only that placeholder is replaced, never a name someone chose.
    const company = values.name.trim()
    if (company && session.workspace.name === DEFAULT_WORKSPACE_NAME) {
      try {
        await rename.mutateAsync({ name: company })
      } catch {
        // The settings are saved; the name can still be changed in Settings → Workspace.
      }
    }
    return true
  }

  // Each step announces itself: focus moves to its heading once it has rendered.
  const go = (to: StepId) => {
    setStep(to)
    if (to === 'done') finish.mutate()
    requestAnimationFrame(() => heading.current?.focus())
  }
  const next = () => go(steps[Math.min(index + 1, steps.length - 1)] ?? 'done')
  const back = index > 0 ? () => go(steps[index - 1] ?? 'welcome') : undefined
  // Focus goes to the first field with an error once the errors are on screen.
  const [invalidTick, setInvalidTick] = useState(0)
  useEffect(() => {
    if (invalidTick) document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [invalidTick])
  const saveAndNext = async () => {
    if (save.isPending) return
    if (await persist(true)) next()
    else setInvalidTick((tick) => tick + 1)
  }

  /** Leaves the welcome through one of the last step's actions, keeping what was typed. */
  const leave = async (to?: string, then?: () => void) => {
    if (finish.isPending) return
    // What was typed and can't be saved stays on screen with its errors, rather than being lost.
    if (!(await persist(false))) return
    try {
      if (!finish.isSuccess) await finish.mutateAsync()
    } catch {
      return // shown in the alert; the page stays so the person can try again
    }
    if (to) setTarget(to)
    queryClient.setQueryData<Session>(
      queryKeys.session,
      (old) => old && { ...old, onboarded: true },
    )
    then?.()
  }

  useEffect(() => heading.current?.focus(), [])

  if (done) return null

  const busy = save.isPending || finish.isPending
  const error = finish.error ?? (save.error && save.error.status !== 422 ? save.error : null)
  const logo = settings.data ? logoSrc(settings.data) || null : null

  return (
    <div className="grid min-h-svh bg-card lg:grid-cols-2">
      <div className="flex min-w-0 flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-6">
        <header className="flex min-h-11 items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <Logo className="size-8" />
          {translate('helvetly')}
        </header>
        <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col pt-8 sm:pt-14 lg:pt-20">
          <Progress index={index} total={steps.length} />
          {error && (
            <Callout tone="danger" role="alert" className="mt-4">
              {errorMessage(error)}
            </Callout>
          )}
          <div
            key={step}
            data-testid={`onboarding-step-${step}`}
            className="mt-8 duration-300 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
          >
            {step === 'welcome' && (
              <WelcomeStep heading={heading} name={firstName(session.user.name)} onDone={next} />
            )}
            {step === 'company' && (
              <CompanyStep
                heading={heading}
                values={values}
                errors={errors}
                busy={busy}
                onChange={change}
                onBack={back}
                onDone={() => void saveAndNext()}
              />
            )}
            {step === 'logo' && (
              <LogoStep
                heading={heading}
                url={logo}
                ready={!!settings.data}
                onBack={back}
                onDone={next}
              />
            )}
            {step === 'preferences' && (
              <PreferencesStep
                heading={heading}
                values={values}
                edited={edited !== null}
                busy={busy}
                onChange={change}
                onBack={back}
                onSkip={next}
                onDone={() => void saveAndNext()}
              />
            )}
            {step === 'done' && (
              <DoneStep
                heading={heading}
                settings={settings.data}
                busy={busy}
                onOpen={(href) => void leave(href)}
                onAskHeidi={() => void leave(undefined, () => heidi?.ask())}
                onClose={() => void leave()}
              />
            )}
          </div>
        </main>
        <footer className="mt-8 flex">
          <ThemeToggle />
        </footer>
      </div>
      {step === 'welcome' ? (
        <LoginShowcase className="m-3 hidden lg:flex" />
      ) : (
        <aside
          aria-label={translate('invoicePreview')}
          className="relative isolate m-3 hidden flex-col items-center justify-center gap-8 overflow-hidden rounded-2xl border bg-muted/70 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:14px_14px] p-10 lg:flex"
        >
          <div className="grid max-w-sm gap-2 text-center">
            <h2 className="text-xl font-semibold tracking-tight">
              {translate('yourFirstInvoice')}
              <span className="text-primary">{translate('takingShape')}</span>
            </h2>
            <p className="text-sm text-balance text-muted-foreground">
              {translate('whatYouFillInOnTheLeftIsWhat')}
            </p>
          </div>
          <InvoicePreview values={values} logo={logo} />
        </aside>
      )}
    </div>
  )
}

/** Done, current and upcoming steps as thin bars; the native progress element tells assistive tech. */
function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="grid gap-2.5">
      <p className="text-xs font-medium text-muted-foreground">
        {translate('step')}
        {index + 1}
        {translate('of5')}
        {total}
      </p>
      <progress
        className="sr-only"
        aria-label={translate('setupProgress')}
        value={index + 1}
        max={total}
      />
      <div aria-hidden className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                'block h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none',
                i < index || index === total - 1 ? 'w-full' : i === index ? 'w-1/2' : 'w-0',
              )}
            />
          </span>
        ))}
      </div>
    </div>
  )
}

type HeadingRef = RefObject<HTMLHeadingElement | null>

function StepHeader({
  heading,
  title,
  children,
}: {
  heading: HeadingRef
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-[28px] leading-tight font-semibold tracking-tight text-balance outline-none sm:text-[32px]"
      >
        {title}
      </h1>
      {children && <p className="text-[15px] text-pretty text-muted-foreground">{children}</p>}
    </div>
  )
}

/** Back on the left; on the right a quiet way past the step, then the one primary action. */
function Actions({
  onBack,
  skip,
  children,
}: {
  onBack?: () => void
  skip?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
      {onBack ? (
        <Button
          size="xl"
          type="button"
          variant="ghost"
          className={cn(bigButton, '-ml-3 px-3')}
          onClick={onBack}
        >
          <ArrowLeft />
          {translate('back')}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-1">
        {skip}
        {children}
      </div>
    </div>
  )
}

function SkipButton({
  onClick,
  children = translate('skip'),
}: {
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <Button
      size="xl"
      type="button"
      variant="ghost"
      className={cn(bigButton, 'text-muted-foreground hover:text-foreground')}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

const bigButton = 'pointer-coarse:h-11'
const card = 'rounded-xl border bg-card p-4'

function WelcomeStep({
  heading,
  name,
  onDone,
}: {
  heading: HeadingRef
  name: string
  onDone: () => void
}) {
  const features = [
    {
      icon: <ReceiptText className="size-[18px] stroke-[1.75]" />,
      title: translate('getPaid'),
      text: translate('invoicesWithTheSwissQRBillOrAsE'),
    },
    {
      icon: <FolderOpen className="size-[18px] stroke-[1.75]" />,
      title: translate('clientsDocuments'),
      text: translate('contractsFromTemplatesESignaturesAndAPortalWhere'),
    },
    {
      icon: <FileUp className="size-[18px] stroke-[1.75]" />,
      title: translate('bringYourData'),
      text: translate('dropInSpreadsheetsPDFsOrReceiptsAITurnsThem'),
    },
    {
      icon: <HeidiSparkle className="size-[18px]" />,
      title: translate('heidiYourAssistant'),
      text: (
        <>
          {translate('askAboutYourNumbersOrLetHerDraftFor')}
          <Kbd>{translate('j')}</Kbd>.
        </>
      ),
      heidi: true,
    },
  ]
  return (
    <div>
      <HeidiOrb />
      <div className="mt-8">
        <StepHeader
          heading={heading}
          title={
            name ? translate('welcomeToHelvetly2', { name: name }) : translate('welcomeToHelvetly')
          }
        >
          {translate('aFewQuickStepsToGetYourCompanyReady')}
        </StepHeader>
      </div>
      <ul className="mt-8 grid gap-2.5">
        {features.map((feature) => (
          <li key={feature.title} className={cn(card, 'flex items-start gap-3.5')}>
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                feature.heidi ? 'bg-heidi-soft/60' : 'bg-muted text-muted-foreground',
              )}
            >
              {feature.icon}
            </span>
            <span className="grid gap-0.5">
              <span className="text-sm font-semibold tracking-tight">{feature.title}</span>
              <span className="text-[13px] text-muted-foreground">{feature.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <Actions>
        <Button size="xl" type="button" className={bigButton} onClick={onDone}>
          {translate('getStarted')}
          <ArrowRight />
        </Button>
      </Actions>
    </div>
  )
}

function CompanyStep({
  heading,
  values,
  errors,
  busy,
  onChange,
  onBack,
  onDone,
}: {
  heading: HeadingRef
  values: Values | null
  errors: Errors
  busy: boolean
  onChange: (patch: Partial<Values>) => void
  onBack?: () => void
  onDone: () => void
}) {
  const iban = values ? ibanInfo(values.iban) : { valid: false as const }
  const text = (
    field: 'name' | 'street' | 'street_number' | 'apt' | 'zip' | 'city',
    maxLength: number,
  ) => (
    <input
      {...describedBy(`onboarding-${field}`, errors[field])}
      className={inputClass}
      maxLength={maxLength}
      autoComplete={field === 'apt' ? 'address-line2' : undefined}
      value={values?.[field] ?? ''}
      disabled={!values}
      onChange={(event) => onChange({ [field]: event.target.value })}
    />
  )
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onDone()
      }}
    >
      <StepHeader heading={heading} title={translate('yourCompany')}>
        {translate('whoYourInvoicesComeFromFillInWhatYou')}
      </StepHeader>
      <div className="mt-7 grid gap-4">
        <FormField
          id="onboarding-name"
          label={translate('companyName')}
          error={errors.name}
          required
        >
          {text('name', 70)}
        </FormField>
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
          <FormField
            id="onboarding-street"
            label={translate('street')}
            error={errors.street}
            required
          >
            {text('street', 70)}
          </FormField>
          <FormField
            id="onboarding-street_number"
            label={translate('number')}
            error={errors.street_number}
            required
          >
            {text('street_number', 16)}
          </FormField>
        </div>
        <FormField
          id="onboarding-apt"
          label={`${translate('aptSuite')} (${translate('optional').toLowerCase()})`}
          error={errors.apt}
        >
          {text('apt', 50)}
        </FormField>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <FormField id="onboarding-zip" label="ZIP" error={errors.zip} required>
            {text('zip', 16)}
          </FormField>
          <FormField id="onboarding-city" label={translate('city')} error={errors.city} required>
            {text('city', 35)}
          </FormField>
        </div>
        <FormField
          id="onboarding-country"
          label={translate('country')}
          error={errors.country ?? unsupportedSellerCountry(values?.country ?? '')}
          required
        >
          <Combobox
            id="onboarding-country"
            value={values?.country ?? 'CH'}
            options={COUNTRY_OPTIONS}
            placeholder={translate('chooseACountry2')}
            invalid={!!(errors.country ?? unsupportedSellerCountry(values?.country ?? ''))}
            onChange={(country) => onChange({ country })}
          />
        </FormField>
        {values && <VatCard values={values} error={errors.vat_number} onChange={onChange} />}
        <FormField
          id="onboarding-iban"
          label="IBAN"
          error={errors.iban}
          hint={
            iban.valid
              ? iban.qr
                ? translate('aQRIBANInvoicesGetAQRReferenceQRR')
                : translate('invoicesGetACreditorReferenceSCOR')
              : translate('whereClientsPayYouPrintedOnTheQRBill')
          }
        >
          <input
            {...describedBy('onboarding-iban', errors.iban)}
            className={cn(inputClass, 'font-mono tracking-wide')}
            placeholder={translate('ch9300762011623852957')}
            autoComplete="off"
            spellCheck={false}
            value={values?.iban ?? ''}
            disabled={!values}
            onChange={(event) => onChange({ iban: event.target.value })}
            onBlur={(event) => {
              const info = ibanInfo(event.target.value)
              if (info.valid) onChange({ iban: info.formatted })
            }}
          />
        </FormField>
      </div>
      <Actions onBack={onBack}>
        <Button size="xl" type="submit" className={bigButton} disabled={busy || !values}>
          {busy ? translate('saving') : translate('continue')} <ArrowRight />
        </Button>
      </Actions>
    </form>
  )
}

/**
 * VAT as one option card, like Settings → Invoices: the whole card toggles it, and the UID opens
 * inside it. A Swiss UID is typed as its nine digits between "CHE-" and the suffix of the invoice
 * language; any other country's VAT number is typed as it is.
 */
function VatCard({
  values,
  error,
  onChange,
}: {
  values: Values
  error?: string
  onChange: (patch: Partial<Values>) => void
}) {
  const on = values.vat_registered
  const swiss = values.country === 'CH' || values.country === 'LI'
  const digits = uidDigits(values.vat_number)
  const shown = digits.match(/.{1,3}/g)?.join('.') ?? ''
  const suffix = vatSuffix(values.language)
  return (
    <div className="grid gap-4">
      <SwitchRow
        id="onboarding-vat"
        className="p-4"
        label={translate('registeredForVAT')}
        description={
          on
            ? translate('invoicesShowYourUIDWithAndVATPerRate', { suffix: suffix })
            : translate('invoicesCarryNoVATAndSaySo')
        }
        checked={on}
        onCheckedChange={(vat_registered) => onChange({ vat_registered })}
      />
      {on && (
        <div className="duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
          <FormField
            id="onboarding-vat_number"
            label={swiss ? translate('uidNumber') : translate('vatNumber')}
            error={error}
          >
            {swiss ? (
              <InputGroup className="h-9 bg-card">
                <InputGroupAddon>
                  <InputGroupText className="font-mono text-foreground">
                    {translate('che2')}
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  {...describedBy('onboarding-vat_number', error)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="123.456.789"
                  className="font-mono"
                  value={shown}
                  onChange={(event) => {
                    const typed = uidDigits(event.target.value)
                    onChange({
                      vat_number: typed ? `CHE-${typed.match(/.{1,3}/g)?.join('.') ?? ''}` : '',
                    })
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText className="font-mono">{suffix}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <input
                {...describedBy('onboarding-vat_number', error)}
                className={cn(inputClass, 'font-mono')}
                autoComplete="off"
                value={values.vat_number}
                onChange={(event) => onChange({ vat_number: event.target.value })}
              />
            )}
          </FormField>
        </div>
      )}
    </div>
  )
}

function LogoStep({
  heading,
  url,
  ready,
  onBack,
  onDone,
}: {
  heading: HeadingRef
  url: string | null
  ready: boolean
  onBack?: () => void
  onDone: () => void
}) {
  return (
    <div>
      <StepHeader heading={heading} title={translate('addYourLogo')}>
        {translate('itGoesTopLeftOnEveryInvoiceAndCredit')}
      </StepHeader>
      <div className="mt-7">{ready && <LogoCard url={url} />}</div>
      <Actions onBack={onBack} skip={!url && <SkipButton onClick={onDone} />}>
        <Button size="xl" type="button" className={bigButton} onClick={onDone}>
          {translate('continue2')}
          <ArrowRight />
        </Button>
      </Actions>
    </div>
  )
}

function PreferencesStep({
  heading,
  values,
  edited,
  busy,
  onChange,
  onBack,
  onSkip,
  onDone,
}: {
  heading: HeadingRef
  values: Values | null
  edited: boolean
  busy: boolean
  onChange: (patch: Partial<Values>) => void
  onBack?: () => void
  onSkip: () => void
  onDone: () => void
}) {
  const days = values?.default_terms_days ?? 30
  const terms = [...new Set([10, 30, 60, days])].toSorted((a, b) => a - b)
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onDone()
      }}
    >
      <StepHeader heading={heading} title={translate('invoiceDefaults')}>
        {translate('whatANewInvoiceStartsWithEachClientAnd')}
      </StepHeader>
      <div className="mt-7 grid gap-5">
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">{translate('language')}</legend>
          <Segmented
            label={translate('invoiceLanguage')}
            value={values?.language ?? 'de'}
            options={LANGUAGES}
            onChange={(language) => onChange({ language })}
          />
        </fieldset>
        <FormField id="onboarding-currency" label={translate('currency')} className="max-w-56">
          <Combobox
            id="onboarding-currency"
            value={values?.currency ?? 'CHF'}
            options={CURRENCY_OPTIONS}
            placeholder={translate('chooseACurrency2')}
            onChange={(currency) => onChange({ currency })}
          />
        </FormField>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium">{translate('paymentTerms')}</legend>
          <Segmented
            label={translate('paymentTerms')}
            value={String(days)}
            options={terms.map((value) => ({
              value: String(value),
              label: translate('days5', { value: value }),
            }))}
            onChange={(value) => onChange({ default_terms_days: Number(value) })}
          />
        </fieldset>
      </div>
      <Actions onBack={onBack} skip={!edited && <SkipButton onClick={onSkip} />}>
        <Button size="xl" type="submit" className={bigButton} disabled={busy || !values}>
          {busy ? translate('saving') : translate('continue')} <ArrowRight />
        </Button>
      </Actions>
    </form>
  )
}

function DoneStep({
  heading,
  settings,
  busy,
  onOpen,
  onAskHeidi,
  onClose,
}: {
  heading: HeadingRef
  settings: InvoiceSettings | undefined
  busy: boolean
  onOpen: (href: string) => void
  onAskHeidi: () => void
  onClose: () => void
}) {
  const missing = settings?.missing_fields ?? []
  const items: { done: boolean; key: string; text: ReactNode }[] = settings
    ? [
        {
          key: 'company',
          done: missing.length === 0,
          text:
            missing.length === 0 ? (
              translate('yourCompanyIsReadyToIssueInvoices')
            ) : (
              <>
                {translate('stillNeededToIssueInvoices')}{' '}
                {missing.map((field) => MISSING_LABELS[field] ?? field).join(', ')}.{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-3"
                  onClick={() => onOpen('/settings/invoices')}
                >
                  {translate('finishInSettings')}
                </button>
              </>
            ),
        },
        ...(settings.logo_url
          ? [{ key: 'logo', done: true, text: translate('yourLogoIsOnEveryPDF') }]
          : []),
      ]
    : []
  return (
    <div>
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/5 text-primary ring-1 ring-border">
        <PartyPopper className="size-7 stroke-[1.75] motion-safe:animate-[bounce_1s_ease-in-out_2]" />
      </div>
      <div className="mt-6">
        <StepHeader heading={heading} title={translate('youReAllSet')}>
          {translate('hereIsWhereMostPeopleStartHeidiIsOne')}
        </StepHeader>
      </div>
      <ul
        aria-label={translate('whatIsSetUp')}
        className="mt-7 grid divide-y rounded-xl border bg-card"
      >
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground"
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full',
                item.done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {item.done ? <Check className="size-3.5" /> : <CircleDashed className="size-3.5" />}
            </span>
            <span className="min-w-0 wrap-anywhere">{item.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
        <NextStep
          icon={<UserPlus />}
          title={translate('addYourFirstClient')}
          description={translate('whoYouWorkForWithTheirAddressAndContacts')}
          primary
          disabled={busy}
          onClick={() => onOpen('/clients?new=1')}
        />
        <NextStep
          icon={<ReceiptText />}
          title={translate('createAnInvoice')}
          description={translate('draftItPreviewThePDFIssueAndSendIt')}
          disabled={busy}
          onClick={() => onOpen('/invoices/new')}
        />
        <NextStep
          icon={<FileUp />}
          title={translate('importYourClients')}
          description={translate('fromASpreadsheetPDFOrYourOldToolYou')}
          disabled={busy}
          onClick={() => onOpen('/clients?import=1')}
        />
        <NextStep
          icon={<HeidiSparkle />}
          title={
            <>
              {translate('askHeidi2')}
              <Kbd className="ml-1">{translate('j')}</Kbd>
            </>
          }
          description={translate('askAboutAnythingInYourWorkspace')}
          heidi
          disabled={busy}
          onClick={onAskHeidi}
        />
      </div>
      <Actions>
        <Button size="xl" type="button" className={bigButton} disabled={busy} onClick={onClose}>
          {translate('goToTheDashboard')}
          <ArrowRight />
        </Button>
      </Actions>
    </div>
  )
}

/** One way out of the welcome: a card with what it opens. */
function NextStep({
  icon,
  title,
  description,
  primary,
  heidi,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: ReactNode
  description: string
  primary?: boolean
  heidi?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors outline-none hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
        primary && 'border-foreground/20',
        heidi && 'hover:border-heidi/50',
      )}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]',
          heidi ? 'bg-heidi-soft/60' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </span>
      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </button>
  )
}
