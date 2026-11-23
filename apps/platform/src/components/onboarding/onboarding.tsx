'use client'
import { locale } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
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
  FileUp,
  PartyPopper,
  ReceiptText,
  UserPlus,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { LoginShowcase } from '@/components/auth/login-showcase'
import {
  Combobox,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  inputClass,
} from '@/components/clients/fields'
import { useHeidi } from '@/components/heidi/heidi-provider'
import { ImportDrawer } from '@/components/import/import-drawer'
import { HelpTip } from '@/components/settings/help-tip'
import { NumberFormatField } from '@/components/settings/number-format-field'
import { WorkspaceLogoControl } from '@/components/settings/workspace-logo'
import { useUpdateProfile } from '@/lib/account'
import { useAI } from '@/lib/ai'
import { api, ApiError, errorMessage, type Session } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  exampleNumber,
  numberFormatError,
  numberFormatsFor,
  ibanInfo,
  logoSrc,
  MISSING_LABELS,
  useInvoiceSettings,
  today,
  useSaveInvoiceSettings,
  type DocLanguage,
  type InvoiceSettings,
  type NumberFormat,
  unsupportedSellerCountry,
} from '@/lib/invoices'
import {
  legalFormOptions,
  suggestLegalForm,
  useLegalForms,
  type LegalForms,
} from '@/lib/legal-forms'
import { useCan } from '@/lib/permissions'
import { queryKeys, useAuthConfig, useSession } from '@/lib/queries'
import { safeNextPath } from '@/lib/safe'
import { useUpdateWorkspace } from '@/lib/workspaces'

import { InvoicePreview } from './invoice-preview'
import { LogoCard } from './logo-card'
import { NumberSuggestion } from './number-suggestion'
import {
  fieldErrors,
  toSettingsInput,
  uidDigits,
  stepsFor,
  validate,
  validPersonName,
  validWorkspaceName,
  MAX_PERSON_NAME,
  MAX_WORKSPACE_NAME,
  valuesFrom,
  vatSuffix,
  type StepId,
  type Values,
} from './onboarding-model'
import { TypedWelcomeTitle } from './welcome-intro'

type Errors = Partial<Record<string, string>>

const LANGUAGES: { value: DocLanguage; label: string }[] = [
  { value: 'de', label: translate('deutsch') },
  { value: 'fr', label: translate('franAis') },
  { value: 'it', label: translate('italiano') },
  { value: 'en', label: translate('english') },
]

// Public-site locales do not extend the languages supported by financial documents.
const interfaceLanguage = LANGUAGES.find(({ value }) => value === locale)?.value

/** What sign-up calls a new workspace (apps/api/internal/auth/signin.go). */
const DEFAULT_WORKSPACE_NAME = 'My workspace'

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
  // The import step needs the installation's AI model (its config, loaded here too: the welcome may open before the
  // shell has it) and write access to documents.
  useAuthConfig()
  const ai = useAI()
  const canImport = useCan('write:documents') && ai.available
  const steps = stepsFor(canImport)
  const [imported, setImported] = useState<string | null>(null)
  const [step, setStep] = useState<StepId>('welcome')
  const index = steps.indexOf(step)
  const heading = useRef<HTMLHeadingElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [chosenTarget, setTarget] = useState<string | null>(null)
  const target = chosenTarget ?? safeNextPath(searchParams.get('next'))

  const settings = useInvoiceSettings()
  const legalForms = useLegalForms().data
  const save = useSaveInvoiceSettings()
  const rename = useUpdateWorkspace()
  const profile = useUpdateProfile()
  // The name is asked for, never guessed from the account (Google or the email address): the input
  // starts empty and the greeting only uses what the server answered to this person's own entry.
  // What this person typed and the server confirmed survives a reload (this browser only), while it still is the account's name.
  const [restoredName] = useState(() => {
    const kept = readKeptName(session.user.id)
    return kept && kept === session.user.name ? kept : null
  })
  const [nameInput, setNameInput] = useState(restoredName ?? '')
  const [nameError, setNameError] = useState<string>()
  const [confirmedName, setConfirmedName] = useState<string | null>(restoredName)
  // Manual and independent of the company: a name already chosen is the starting point, the sign-up
  // placeholder is not. Read once, so a refreshed session never resets what was typed.
  const [workspaceInput, setWorkspaceInput] = useState(() =>
    session.workspace.name === DEFAULT_WORKSPACE_NAME ? '' : session.workspace.name,
  )
  const [workspaceError, setWorkspaceError] = useState<string>()
  // What the server already has from this step, so a retry after a half-saved attempt repeats only the missing write.
  const savedProfile = useRef<string | null>(restoredName)
  const [edited, setEdited] = useState<Values | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const values = edited ?? (settings.data ? valuesFrom(settings.data, interfaceLanguage) : null)
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
    const problems: Errors = validate(values, legalForms)
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
    return true
  }

  const go = (to: StepId) => {
    setStep(to)
    if (to === 'done') finish.mutate()
  }
  // Each step announces itself, the first included: when its keyed container is committed (not a frame later,
  // which can come before it) the scroller starts at the step's top, progress bar included, and focus moves to
  // the new heading, already attached by then.
  const announce = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    if (scroller.current) scroller.current.scrollTop = 0
    heading.current?.focus()
  }, [])
  const next = () => go(steps[Math.min(index + 1, steps.length - 1)] ?? 'done')
  const back = index > 0 ? () => go(steps[index - 1] ?? 'welcome') : undefined
  // Focus goes to the first field with an error once the errors are on screen.
  const [invalidTick, setInvalidTick] = useState(0)
  useEffect(() => {
    if (invalidTick) document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [invalidTick])
  // A ref, because a second submit in the same tick still sees the state of the first render.
  const welcomeSaving = useRef(false)
  const [welcomeBusy, setWelcomeBusy] = useState(false)
  const saveWelcome = async () => {
    if (welcomeSaving.current) return
    welcomeSaving.current = true
    setWelcomeBusy(true)
    try {
      await saveWelcomeNames()
    } finally {
      welcomeSaving.current = false
      setWelcomeBusy(false)
    }
  }
  const saveWelcomeNames = async () => {
    const name = nameInput.trim()
    const workspace = workspaceInput.trim()
    const nameProblem = validPersonName(name)
      ? undefined
      : translate('enterANameOfUpToCharacters', { max: MAX_PERSON_NAME })
    const workspaceProblem = validWorkspaceName(workspace)
      ? undefined
      : workspace
        ? translate('enterANameOfUpToCharacters', { max: MAX_WORKSPACE_NAME })
        : translate('thisIsRequired')
    setNameError(nameProblem)
    setWorkspaceError(workspaceProblem)
    if (nameProblem || workspaceProblem) {
      setInvalidTick((tick) => tick + 1)
      return
    }
    try {
      if (savedProfile.current !== name) {
        const { data } = await profile.mutateAsync({ name })
        savedProfile.current = name
        setConfirmedName(data.name)
        keepName(session.user.id, data.name)
      }
    } catch (error) {
      // Stays on this step with both inputs as typed.
      if (error instanceof ApiError && error.status === 422)
        setNameError(fieldErrors(error.details).name ?? errorMessage(error))
      setInvalidTick((tick) => tick + 1)
      return
    }
    try {
      if (workspace !== session.workspace.name) await rename.mutateAsync({ name: workspace })
    } catch (error) {
      // The account name is saved; a retry sends only the workspace name.
      setWorkspaceError(errorMessage(error))
      setInvalidTick((tick) => tick + 1)
      return
    }
    next()
  }
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

  if (done) return null

  const busy = save.isPending || finish.isPending
  const error =
    finish.error ??
    (profile.error && profile.error.status !== 422 ? profile.error : null) ??
    (save.error && save.error.status !== 422 ? save.error : null)
  const logo = settings.data ? logoSrc(settings.data) || null : null

  return (
    <div className="grid min-h-svh bg-card lg:h-svh lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-6">
        <header className="flex min-h-11 items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <Logo className="size-8" />
          {translate('helvetly')}
        </header>
        <div
          ref={scroller}
          className="flex min-h-0 flex-1 flex-col lg:scroll-py-6 lg:overflow-y-auto lg:overscroll-contain"
        >
          <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col pt-8 sm:pt-14 lg:px-1 lg:pt-12 lg:pb-6">
            <Progress index={index} total={steps.length} />
            {error && (
              <Callout tone="danger" role="alert" className="mt-4">
                {errorMessage(error)}
              </Callout>
            )}
            <div
              key={step}
              ref={announce}
              data-testid={`onboarding-step-${step}`}
              className="mt-8 duration-300 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
            >
              {step === 'welcome' && (
                <WelcomeStep
                  heading={heading}
                  name={confirmedName}
                  input={nameInput}
                  error={nameError}
                  busy={welcomeBusy}
                  workspace={workspaceInput}
                  workspaceError={workspaceError}
                  onInput={(value) => {
                    setNameInput(value)
                    setNameError(undefined)
                  }}
                  onWorkspace={(value) => {
                    setWorkspaceInput(value)
                    setWorkspaceError(undefined)
                  }}
                  onDone={() => void saveWelcome()}
                />
              )}
              {step === 'company' && (
                <CompanyStep
                  heading={heading}
                  values={values}
                  legalForms={legalForms}
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
                  workspace={session.workspace}
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
              {step === 'import' && (
                <ImportStep
                  heading={heading}
                  imported={imported}
                  onCreated={setImported}
                  onNumberFormat={(number_format) =>
                    setEdited((current) => current && { ...current, number_format })
                  }
                  onBack={back}
                  onDone={next}
                />
              )}
              {step === 'done' && (
                <DoneStep
                  heading={heading}
                  imported={imported}
                  name={confirmedName}
                  settings={settings.data}
                  busy={busy}
                  onOpen={(href) => void leave(href)}
                  canImport={canImport}
                  onAskHeidi={heidi ? () => void leave(undefined, () => heidi.ask()) : undefined}
                  onClose={() => void leave()}
                />
              )}
            </div>
          </main>
        </div>
        <footer className="mt-4 flex shrink-0 lg:pt-2">
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
          <div className="grid max-w-sm gap-2 text-center [@media(max-height:46rem)]:hidden">
            <h2 className="text-xl font-semibold tracking-tight">
              {translate('yourFirstInvoice')}
              <span className="text-primary">{translate('takingShape')}</span>
            </h2>
            <p className="text-sm text-balance text-muted-foreground">
              {translate('whatYouFillInOnTheLeftIsWhat')}
            </p>
          </div>
          <InvoicePreview values={values} logo={logo} vat={settings.data} />
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

function WelcomeStep({
  heading,
  name,
  input,
  error,
  busy,
  workspace,
  workspaceError,
  onInput,
  onWorkspace,
  onDone,
}: {
  heading: HeadingRef
  /** What the server saved for this person's own answer; null until they have given one. */
  name: string | null
  input: string
  error?: string
  busy: boolean
  workspace: string
  workspaceError?: string
  onInput: (value: string) => void
  onWorkspace: (value: string) => void
  onDone: () => void
}) {
  return (
    <div>
      <StepHeader
        heading={heading}
        title={
          <TypedWelcomeTitle
            title={
              name
                ? translate('welcomeToHelvetly2', { name: name })
                : translate('welcomeToHelvetly')
            }
          />
        }
      >
        {translate('aFewQuickStepsToGetYourCompanyReady')}
      </StepHeader>
      <form
        noValidate
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault()
          onDone()
        }}
      >
        <FormField
          id="onboarding-display-name"
          label={translate('whatShouldWeCallYou')}
          tip={translate('preferredNameHelp')}
          error={error}
          required
        >
          <input
            {...describedBy('onboarding-display-name', error)}
            className={inputClass}
            maxLength={MAX_PERSON_NAME}
            autoComplete="off"
            value={input}
            readOnly={busy}
            onChange={(event) => onInput(event.target.value)}
          />
        </FormField>
        <FormField
          id="onboarding-workspace-name"
          label={translate('workspaceName')}
          tip={translate('workspaceNameHelp')}
          error={workspaceError}
          required
          className="mt-4"
        >
          <input
            {...describedBy('onboarding-workspace-name', workspaceError)}
            className={inputClass}
            maxLength={MAX_WORKSPACE_NAME}
            autoComplete="off"
            value={workspace}
            readOnly={busy}
            onChange={(event) => onWorkspace(event.target.value)}
          />
        </FormField>
        <Actions>
          <Button size="xl" type="submit" className={bigButton} disabled={busy}>
            {busy ? translate('saving') : translate('getStarted')}
            <ArrowRight />
          </Button>
        </Actions>
      </form>
    </div>
  )
}

function CompanyStep({
  heading,
  values,
  legalForms,
  errors,
  busy,
  onChange,
  onBack,
  onDone,
}: {
  heading: HeadingRef
  values: Values | null
  legalForms: LegalForms | undefined
  errors: Errors
  busy: boolean
  onChange: (patch: Partial<Values>) => void
  onBack?: () => void
  onDone: () => void
}) {
  const iban = values ? ibanInfo(values.iban) : { valid: false as const }
  const formOptions = legalFormOptions(legalForms, values?.country ?? 'CH')
  // The form follows the name's ending ("… GmbH") until the person picks another one.
  const withName = (name: string): Partial<Values> => {
    if (!values) return { name }
    const before = suggestLegalForm(legalForms, values.country, values.name)
    const following = !values.legal_form || values.legal_form === before
    return following
      ? { name, legal_form: suggestLegalForm(legalForms, values.country, name) ?? '' }
      : { name }
  }
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
      onChange={(event) =>
        onChange(field === 'name' ? withName(event.target.value) : { [field]: event.target.value })
      }
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
        <FormField
          id="onboarding-legal_form"
          label={translate('legalForm')}
          error={errors.legal_form}
          required={formOptions.length > 0}
          tip={translate('legalFormTip')}
        >
          <Combobox
            id="onboarding-legal_form"
            value={values?.legal_form ?? ''}
            options={formOptions}
            disabled={!values || formOptions.length === 0}
            placeholder={
              legalForms && formOptions.length === 0
                ? translate('noLegalFormsForThisCountryYet')
                : translate('chooseALegalForm')
            }
            invalid={!!errors.legal_form}
            onChange={(legal_form) => onChange({ legal_form })}
          />
        </FormField>
        {/* Street, number and apartment in one row, as in the client form; only the missing asterisk marks apt optional. */}
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] gap-3">
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
          <FormField id="onboarding-apt" label={translate('aptSuite')} error={errors.apt}>
            {text('apt', 50)}
          </FormField>
        </div>
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
            onChange={(country) =>
              onChange({
                country,
                legal_form: suggestLegalForm(legalForms, country, values?.name ?? '') ?? '',
                ...presetFor(values, country),
              })
            }
          />
        </FormField>
        {values && <VatCard values={values} error={errors.vat_number} onChange={onChange} />}
        <FormField
          id="onboarding-iban"
          label="IBAN"
          error={errors.iban}
          hint={translate('whereClientsPayYouPrintedOnTheQRBill')}
          status={
            iban.valid &&
            (iban.qr
              ? translate('aQRIBANInvoicesGetAQRReferenceQRR')
              : translate('invoicesGetACreditorReferenceSCOR'))
          }
        >
          <input
            {...describedBy('onboarding-iban', errors.iban)}
            className={cn(inputClass, 'font-code tracking-wide')}
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
            : translate('invoicesCarryNoVATThePricesAreTheTotals')
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
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText className="font-code text-foreground">
                    {translate('che2')}
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  {...describedBy('onboarding-vat_number', error)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="123.456.789"
                  className="font-code"
                  value={shown}
                  onChange={(event) => {
                    const typed = uidDigits(event.target.value)
                    onChange({
                      vat_number: typed ? `CHE-${typed.match(/.{1,3}/g)?.join('.') ?? ''}` : '',
                    })
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText className="font-code">{suffix}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <input
                {...describedBy('onboarding-vat_number', error)}
                className={cn(inputClass, 'font-code')}
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

/** A preset number format follows the country to the new country's first preset; a custom one stays. */
function presetFor(values: Values | null, country: string): Partial<Values> {
  const format = values?.number_format ?? '{YYYY}-{NNN}'
  return numberFormatsFor(values?.country ?? 'CH').includes(format)
    ? { number_format: numberFormatsFor(country)[0] }
    : {}
}

function LogoStep({
  heading,
  url,
  workspace,
  ready,
  onBack,
  onDone,
}: {
  heading: HeadingRef
  url: string | null
  workspace: Session['workspace']
  ready: boolean
  onBack?: () => void
  onDone: () => void
}) {
  return (
    <div>
      <StepHeader heading={heading} title={translate('addYourLogo')}>
        {translate('itGoesTopLeftOnEveryInvoiceAndCredit')}
      </StepHeader>
      <div className="mt-7 grid gap-6">
        <section className="grid gap-2">
          <LogoLabel help={translate('workspaceLogoHelp')}>{translate('workspaceLogo')}</LogoLabel>
          <WorkspaceLogoControl name={workspace.name} logoUrl={workspace.logo_url} canEdit />
        </section>
        <section className="grid gap-2">
          <LogoLabel help={translate('documentLogoHelp')}>{translate('documentLogo')}</LogoLabel>
          {ready && <LogoCard url={url} />}
        </section>
      </div>
      <Actions onBack={onBack} skip={!url && <SkipButton onClick={onDone} />}>
        <Button size="xl" type="button" className={bigButton} onClick={onDone}>
          {translate('continue2')}
          <ArrowRight />
        </Button>
      </Actions>
    </div>
  )
}

/** A logo's name with its explanation behind a help icon. */
function LogoLabel({ children, help }: { children: string; help: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium">
      {children}
      <HelpTip label={children}>{help}</HelpTip>
    </span>
  )
}

/** The presets of the payment terms; any other saved number is shown as Custom. */
const PAYMENT_TERM_PRESETS = [7, 14, 30]

/** A whole number of days from 0 (the invoice date itself) to 365, as the server accepts; null for anything else. */
const parseTermsDays = (text: string) => {
  const trimmed = text.trim()
  const number = /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null
  return number !== null && number <= 365 ? number : null
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
  const numberFormat = values?.number_format ?? '{YYYY}-{NNN}'
  const [formatInvalid, setFormatInvalid] = useState(false)
  const formatError = formatInvalid ? (numberFormatError(numberFormat) ?? undefined) : undefined
  // A saved 10, 60 or any other number is shown as Custom with its value, never rewritten by showing it.
  const [customChosen, setCustomChosen] = useState(false)
  // What is typed in the days field while it is not (yet) a number that can be saved.
  const [typed, setTyped] = useState<string | null>(null)
  const [termsInvalid, setTermsInvalid] = useState(false)
  const termsField = useRef<HTMLInputElement>(null)
  const custom = customChosen || !PAYMENT_TERM_PRESETS.includes(days)
  const shownDays = typed ?? String(days)
  const typedDays = parseTermsDays(shownDays)
  const termsError = termsInvalid && typedDays === null ? translate('enter0To365Days') : undefined
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (custom && typedDays === null) {
          setTermsInvalid(true)
          termsField.current?.focus()
          return
        }
        if (numberFormatError(numberFormat)) {
          setFormatInvalid(true)
          return
        }
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
        <FormField
          id="onboarding-number-format"
          label={translate('numberFormat')}
          error={formatError}
          status={
            !formatError &&
            translate('yourNextInvoiceNumber', { number: exampleNumber(numberFormat, today(), 1) })
          }
          className="max-w-56"
        >
          <NumberFormatField
            id="onboarding-number-format"
            country={values?.country ?? 'CH'}
            value={numberFormat}
            invalid={Boolean(formatError)}
            onChange={(number_format) => onChange({ number_format })}
          />
        </FormField>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
            {translate('paymentTerms')}
            <HelpTip label={translate('paymentTerms')}>{translate('paymentTermsHelp')}</HelpTip>
          </legend>
          <div className="flex min-h-9 flex-wrap items-center gap-2">
            <Segmented
              label={translate('paymentTerms')}
              value={custom ? 'custom' : String(days)}
              options={[
                ...PAYMENT_TERM_PRESETS.map((value) => ({
                  value: String(value),
                  label: translate('days5', { value: value }),
                })),
                { value: 'custom', label: translate('custom') },
              ]}
              onChange={(value) => {
                setTyped(null)
                setTermsInvalid(false)
                setCustomChosen(value === 'custom')
                if (value !== 'custom') onChange({ default_terms_days: Number(value) })
              }}
            />
            {custom && (
              <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <input
                  {...describedBy('onboarding-terms', termsError)}
                  ref={termsField}
                  aria-label={translate('numberOfDays')}
                  className={cn(inputClass, 'w-20 tabular-nums')}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  disabled={!values}
                  value={shownDays}
                  onChange={(event) => {
                    const text = event.target.value
                    setTyped(text)
                    setTermsInvalid(false)
                    const number = parseTermsDays(text)
                    if (number !== null) onChange({ default_terms_days: number })
                  }}
                />
                {translate('days')}
              </span>
            )}
          </div>
          {termsError && (
            <p id="onboarding-terms-error" className="text-xs text-destructive">
              {termsError}
            </p>
          )}
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

/** Optional: the existing AI import in its drawer; the drawer asks for the AI approval when the files are read. */
function ImportStep({
  heading,
  imported,
  onCreated,
  onNumberFormat,
  onBack,
  onDone,
}: {
  heading: HeadingRef
  imported: string | null
  onCreated: (summary: string) => void
  onNumberFormat: (format: NumberFormat) => void
  onBack?: () => void
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <StepHeader heading={heading} title={translate('bringYourData')}>
        {translate('bringYourDataIntro')}
      </StepHeader>
      {imported && (
        <output className="mt-7 block">
          <Callout tone="success">{translate('importedSummary', { summary: imported })}</Callout>
        </output>
      )}
      {imported && (
        <div className="mt-3">
          <NumberSuggestion imported={imported} onApplied={onNumberFormat} />
        </div>
      )}
      <Actions
        onBack={onBack}
        skip={
          imported ? (
            <SkipButton onClick={() => setOpen(true)}>
              {translate('importMoreDocuments')}
            </SkipButton>
          ) : (
            <SkipButton onClick={onDone} />
          )
        }
      >
        <Button
          size="xl"
          type="button"
          className={bigButton}
          onClick={imported ? onDone : () => setOpen(true)}
        >
          {imported ? (
            <>
              {translate('continue2')} <ArrowRight />
            </>
          ) : (
            <>
              <FileUp />
              {translate('importDocuments')}
            </>
          )}
        </Button>
      </Actions>
      {open && <ImportDrawer kind="auto" onCreated={onCreated} onClose={() => setOpen(false)} />}
    </div>
  )
}

function DoneStep({
  heading,
  imported,
  name,
  settings,
  busy,
  canImport,
  onOpen,
  onAskHeidi,
  onClose,
}: {
  heading: HeadingRef
  imported: string | null
  name: string | null
  settings: InvoiceSettings | undefined
  busy: boolean
  onOpen: (href: string) => void
  canImport: boolean
  /** Missing without AI on the installation: no Heidi. */
  onAskHeidi?: () => void
  onClose: () => void
}) {
  const missing = settings?.missing_fields ?? []
  // What is set up is a quiet confirmation; what is still needed to issue invoices is a warning with its way out.
  const ready: { key: string; text: string }[] = settings
    ? [
        ...(missing.length === 0
          ? [{ key: 'company', text: translate('yourCompanyIsReadyToIssueInvoices') }]
          : []),
        ...(settings.logo_url ? [{ key: 'logo', text: translate('yourLogoIsOnEveryPDF') }] : []),
        ...(imported
          ? [{ key: 'import', text: translate('importedSummary', { summary: imported }) }]
          : []),
      ]
    : []
  return (
    <div>
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/5 text-primary ring-1 ring-border">
        <PartyPopper className="size-7 stroke-[1.75] motion-safe:animate-[bounce_1s_ease-in-out_2]" />
      </div>
      <div className="mt-6">
        <StepHeader
          heading={heading}
          title={name ? translate('youReAllSetNamed', { name }) : translate('youReAllSet')}
        >
          {onAskHeidi
            ? translate('hereIsWhereMostPeopleStartHeidiIsOne')
            : translate('hereIsWhereMostPeopleStart')}
        </StepHeader>
      </div>
      {missing.length > 0 && (
        <output className="mt-7 block">
          <Callout
            tone="warning"
            title={translate('stillNeededToIssueInvoices').replace(/:\s*$/, '')}
          >
            <p className="wrap-anywhere">
              {missing.map((field) => MISSING_LABELS[field] ?? field).join(', ')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-fit"
              onClick={() => onOpen('/settings/company')}
            >
              {translate('finishInSettings')}
            </Button>
          </Callout>
        </output>
      )}
      {ready.length > 0 && (
        <ul
          aria-label={translate('whatIsSetUp')}
          className={cn('grid gap-1.5', missing.length ? 'mt-4' : 'mt-7')}
        >
          {ready.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check aria-hidden className="size-4 shrink-0 text-success" />
              <span className="min-w-0 wrap-anywhere">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
        <NextStep
          icon={<UserPlus />}
          title={translate('addYourFirstClient')}
          description={translate('whoYouWorkForWithTheirAddressAndContacts')}
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
        {canImport && (
          <NextStep
            icon={<FileUp />}
            title={imported ? translate('importMoreDocuments') : translate('importYourClients')}
            description={
              imported
                ? translate('importMoreDocumentsHint')
                : translate('fromASpreadsheetPDFOrYourOldToolYou')
            }
            disabled={busy}
            onClick={() => onOpen(imported ? '/documents?import=1' : '/clients?import=1')}
          />
        )}
        {onAskHeidi && (
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
        )}
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

/** One way out of the welcome: a card with what it opens. Quiet at rest; only hover and keyboard focus raise it. */
function NextStep({
  icon,
  title,
  description,
  heidi,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: ReactNode
  description: string
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
        'group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60',
        heidi ? 'hover:border-heidi/40' : 'hover:border-foreground/20',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[17px]',
          heidi ? 'bg-heidi-soft/50' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-pretty text-muted-foreground">{description}</span>
      </span>
      <ArrowRight
        aria-hidden
        className="mt-1 size-4 shrink-0 text-muted-foreground/50 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:text-foreground motion-reduce:transition-none"
      />
    </button>
  )
}

const keptNameKey = (userId: string) => `helvetly.onboarding-name.${userId}`

/** The name this person confirmed on the welcome step, kept in this browser; null when storage is unavailable. */
function readKeptName(userId: string): string | null {
  try {
    return localStorage.getItem(keptNameKey(userId))
  } catch {
    return null
  }
}

function keepName(userId: string, name: string) {
  try {
    localStorage.setItem(keptNameKey(userId), name)
  } catch {
    // A private window: the name is saved on the account anyway, only the reload starts empty.
  }
}
