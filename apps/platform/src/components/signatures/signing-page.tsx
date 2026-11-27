'use client'
import { numberLocale } from '@helvetly/i18n'
import { TONES, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Textarea } from '@helvetly/ui/components/textarea'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  Ban,
  CircleCheck,
  Clock,
  Hourglass,
  Link2Off,
  Loader2,
  type LucideIcon,
  MailCheck,
  OctagonX,
  ShieldCheck,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState, type ReactNode } from 'react'

import { DisabledTip } from '@/components/employees/hr-access'
import { PdfView } from '@/components/invoices/pdf-view'
import { ApiError, errorMessage } from '@/lib/api'
import { useSavedSignature } from '@/lib/contract-signature'
import { translate } from '@/lib/i18n'
import { signaturesApi, signingDocumentUrl, type Field, type SigningView } from '@/lib/signatures'

import { AdoptDialog, type Adopted } from './adopt-dialog'
import { FIELD_ICONS, FieldBox } from './parts'

const SIGNER_COLOR = '#2f6fdf'
// Public page for an external signer: their own zone, not a workspace's, is right.
const today = () =>
  new Intl.DateTimeFormat(numberLocale, {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date())

/** The token from `/sign#<token>`: in the fragment, so it never reaches a server log or a Referer. */
function useToken() {
  const [token, setToken] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const read = () => setToken(window.location.hash.slice(1) || null)
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  return token
}

export const signingKey = (token: string) => ['signing', token] as const

/** The public page a signer opens from their email. */
export function SigningPage() {
  const token = useToken()
  const view = useQuery({
    queryKey: signingKey(token ?? ''),
    queryFn: async () => (await signaturesApi.view(token ?? '')).data,
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  })

  if (token === null)
    return (
      <Notice
        icon={Link2Off}
        title={translate('thisLinkIsIncomplete')}
        text={translate('openTheLinkFromYourEmailAgainTheWhole')}
      />
    )
  if (view.error) {
    const code = view.error instanceof ApiError ? view.error.code : ''
    if (code === 'link_invalid' || (view.error instanceof ApiError && view.error.status === 404))
      return (
        <Notice
          icon={Link2Off}
          title={translate('thisLinkDoesnTWork')}
          text={translate('itMayHaveBeenReplacedByANewerReminder')}
        />
      )
    if (code === 'link_expired')
      return (
        <Notice
          icon={Hourglass}
          title={translate('thisLinkHasExpired')}
          text={translate('askTheSenderToSendTheDocumentAgain')}
        />
      )
    return (
      <Notice
        icon={OctagonX}
        title={translate('somethingWentWrong')}
        text={errorMessage(view.error)}
      />
    )
  }
  if (!token || !view.data) return <Loading />
  return <Signing token={token} view={view.data} />
}

function Signing({ token, view }: { token: string; view: SigningView }) {
  const { request, signer } = view
  const brand = { name: request.workspace, logo: request.logo }
  if (request.status === 'revoked')
    return (
      <Notice
        brand={brand}
        icon={Ban}
        title={translate('thisRequestWasWithdrawn')}
        text={translate('withdrewThereIsNothingToSign', {
          sender: request.workspace,
          title: request.title,
        })}
      />
    )
  if (signer.status === 'signed')
    return (
      <Notice
        brand={brand}
        tone="green"
        icon={CircleCheck}
        title={
          request.status === 'completed' ? translate('everyoneHasSigned') : translate('youVeSigned')
        }
        text={
          request.status === 'completed'
            ? translate('isCompleteTheSignedPDFWithItsCertificateIs', {
                title: request.title,
                email: signer.email,
              })
            : translate('thankYouWhenEveryoneHasSignedTheSignedPDF', {
                name: signer.name,
                title: request.title,
                email: signer.email,
              })
        }
      />
    )
  if (signer.status === 'declined')
    return (
      <Notice
        brand={brand}
        icon={OctagonX}
        title={translate('youDeclinedToSign')}
        text={translate('hasBeenToldNothingMoreToDoHere', { name: request.sender.name })}
      />
    )
  if (request.status === 'declined')
    return (
      <Notice
        brand={brand}
        icon={OctagonX}
        title={translate('signingWasStopped')}
        text={translate('anotherSignerDeclinedSoItCanTBeSigned', {
          title: request.title,
          name: request.sender.name,
        })}
      />
    )
  if (request.status === 'expired')
    return (
      <Notice
        brand={brand}
        icon={Hourglass}
        title={translate('thisRequestHasExpired')}
        text={translate('itRanUntilAskToSendItAgain', {
          value1: formatDate(request.expires_at),
          name: request.sender.name,
        })}
      />
    )
  if (request.status === 'completed')
    return (
      <Notice
        brand={brand}
        tone="green"
        icon={CircleCheck}
        title={translate('thisDocumentIsComplete')}
        text={translate('everyoneHasSignedIt')}
      />
    )
  if (signer.status === 'waiting')
    return (
      <Notice
        brand={brand}
        icon={Clock}
        title={translate('itSNotYourTurnYet')}
        text={translate('isSignedInOrderYouLlGetAnEmail', { title: request.title })}
      />
    )
  return <SignForm token={token} view={view} />
}

/** Whether a field is done: signature adopted, text entered; date and name always are. */
const filled = (field: Field, signature: Adopted | null, values: Record<string, string>) =>
  field.kind === 'signature'
    ? signature !== null
    : field.kind === 'text'
      ? !!values[field.id]?.trim()
      : true

function SignForm({ token, view }: { token: string; view: SigningView }) {
  const queryClient = useQueryClient()
  const { request, signer, fields } = view
  const [signature, setSignature] = useState<Adopted | null>(null)
  const [adopting, setAdopting] = useState(false)
  const saved = useSavedSignature(signer.email).data
  const [values, setValues] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = fields.filter((field) => filled(field, signature, values)).length
  const nextField = fields.find((field) => !filled(field, signature, values))
  const ready = done === fields.length && consent

  const finish = async () => {
    if (!signature) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await signaturesApi.sign(token, {
        consent: true,
        signature,
        values: Object.fromEntries(
          fields
            .filter((field) => field.kind === 'text')
            .map((field) => [field.id, values[field.id]?.trim() ?? '']),
        ),
      })
      queryClient.setQueryData(signingKey(token), data)
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'original_changed'
          ? translate('thisDocumentWasChangedAfterItWasSentSo')
          : errorMessage(caught),
      )
      if (caught instanceof ApiError && caught.code === 'not_signable')
        void queryClient.invalidateQueries({ queryKey: signingKey(token) })
    } finally {
      setBusy(false)
    }
  }

  const goTo = (field: Field | undefined) => {
    if (!field) return
    document
      .querySelector(`[data-field-id="${field.id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (field.kind === 'signature' && !signature) setAdopting(true)
  }

  const overlay = (page: number) => (
    <div className="@container absolute inset-0">
      {fields
        .filter((field) => field.page === page)
        .map((field) => (
          <SigningField
            key={field.id}
            field={field}
            name={signer.name}
            signature={signature}
            value={values[field.id] ?? ''}
            onValue={(value) => setValues({ ...values, [field.id]: value })}
            onSign={() => setAdopting(true)}
          />
        ))}
    </div>
  )

  const from = request.sender.email ? request.sender : null // nobody when the member who sent it is gone
  const progress = translate('signingFieldsProgress', { done, total: fields.length })
  const blocked =
    done < fields.length && !consent
      ? translate('signingFinishNeedsBoth')
      : done < fields.length
        ? translate('signingFinishNeedsFields')
        : !consent
          ? translate('signingFinishNeedsConsent')
          : null

  return (
    <div className="flex min-h-svh flex-col bg-muted/50 dark:bg-background">
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[960px] items-center gap-3 px-4 sm:px-10">
          <BrandMark name={request.workspace} logo={request.logo} />
          <p className="sr-only max-w-48 truncate text-sm font-medium sm:not-sr-only">
            {request.workspace}
          </p>
          <span aria-hidden className="hidden h-6 w-px shrink-0 bg-border sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{request.title}</h1>
            {from && (
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {translate('signingSentBy', { name: from.name })}
              </p>
            )}
          </div>
          <span className="hidden shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground tabular-nums sm:inline">
            {progress}
          </span>
          <Button
            variant="ghost"
            className="shrink-0 cursor-pointer text-muted-foreground"
            onClick={() => setDeclining(true)}
          >
            {translate('decline')}
          </Button>
        </div>
        <div className="h-0.5 bg-transparent">
          <div
            className="h-full bg-brand-solid transition-[width] duration-300"
            style={{ width: `${(done / Math.max(1, fields.length)) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[960px] gap-4 px-0 pt-5 pb-48 sm:px-4">
        <section className="mx-4 grid gap-2.5 rounded-2xl bg-card p-4 ring-1 ring-foreground/[0.06] sm:mx-6 sm:p-5">
          <p className="text-base font-medium text-balance">
            {translate('signingAsksYou', { company: request.workspace, title: request.title })}
          </p>
          {from && (
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {translate('signingSentBy', { name: from.name })}
              <span> · {from.email}</span>
            </p>
          )}
          {request.message && (
            <p className="text-sm text-pretty whitespace-pre-line">{request.message}</p>
          )}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 stroke-[1.75]" />
            {translate('signingSesShort')}
            <span aria-hidden>·</span>
            <Popover>
              <PopoverTrigger className="cursor-pointer underline underline-offset-2 hover:text-foreground">
                {translate('signingWhatDoesThisMean')}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                collisionPadding={12}
                className="w-80 max-w-[calc(100vw-24px)] p-4 text-body-sm"
              >
                {translate('aSimpleElectronicSignatureSESUnderSwissZertESAnd')}
              </PopoverContent>
            </Popover>
          </p>
        </section>
        <PdfView
          src={signingDocumentUrl(token)}
          title={request.title}
          className="overflow-visible bg-transparent dark:bg-transparent"
          overlay={overlay}
        />
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-[960px] gap-3 px-4 py-3 sm:flex sm:items-center sm:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <Checkbox
              id="signing-consent"
              checked={consent}
              onCheckedChange={(on) => setConsent(on === true)}
            />
            <label htmlFor="signing-consent" className="cursor-pointer">
              {translate('iAgreeToSignElectronically')}
            </label>
            <Popover>
              <PopoverTrigger className="cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {translate('signingConsentDetails')}
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                collisionPadding={12}
                className="w-96 max-w-[calc(100vw-24px)] p-4 text-body-sm"
              >
                {view.consent_text}
              </PopoverContent>
            </Popover>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums sm:hidden">
              {progress}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {nextField ? (
              <Button
                size="xl"
                variant="outline"
                className="flex-1 cursor-pointer gap-1.5 sm:flex-none"
                onClick={() => goTo(nextField)}
              >
                <ArrowDown className="size-4" />
                {translate('nextField')}
              </Button>
            ) : null}
            <DisabledTip reason={busy ? null : blocked}>
              <Button
                size="xl"
                className="flex-1 cursor-pointer sm:flex-none"
                disabled={!ready || busy}
                onClick={() => void finish()}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {translate('finish')}
              </Button>
            </DisabledTip>
          </div>
          {error && <InlineError className="sm:basis-full">{error}</InlineError>}
        </div>
      </footer>

      {adopting && (
        <AdoptDialog
          name={signer.name}
          saved={saved}
          onClose={() => setAdopting(false)}
          onAdopt={(adopted) => {
            setSignature(adopted)
            setAdopting(false)
          }}
        />
      )}
      {declining && <DeclineDialog token={token} onClose={() => setDeclining(false)} />}
    </div>
  )
}

function SigningField({
  field,
  name,
  signature,
  value,
  onValue,
  onSign,
}: {
  field: Field
  name: string
  signature: Adopted | null
  value: string
  onValue: (value: string) => void
  onSign: () => void
}) {
  const Icon = FIELD_ICONS[field.kind]
  if (field.kind === 'signature')
    return (
      <FieldBox
        box={field}
        kind="signature"
        color={SIGNER_COLOR}
        data-field-id={field.id}
        className="p-0"
        style={
          signature ? { borderColor: 'transparent', backgroundColor: 'transparent' } : undefined
        }
      >
        <button
          type="button"
          onClick={onSign}
          aria-label={signature ? translate('changeYourSignature') : translate('signHere2')}
          className={cn(
            'flex size-full cursor-pointer items-center justify-center gap-1 font-medium',
            !signature && 'animate-pulse hover:animate-none motion-reduce:animate-none',
          )}
        >
          {signature ? (
            <span
              aria-hidden
              className="size-full bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${signature.image})` }}
            />
          ) : (
            <>
              <Icon className="size-[1.2em]" />
              {translate('signHere')}
            </>
          )}
        </button>
      </FieldBox>
    )
  if (field.kind === 'text')
    return (
      <FieldBox
        box={field}
        kind="text"
        color={SIGNER_COLOR}
        data-field-id={field.id}
        className="p-0"
      >
        <input
          aria-label={field.label ?? translate('text')}
          placeholder={field.label ?? translate('text')}
          value={value}
          maxLength={200}
          onChange={(event) => onValue(event.target.value)}
          className="size-full bg-transparent px-1 text-[clamp(9px,1.6cqw,14px)] text-[#1c2a4a] outline-none placeholder:text-current placeholder:opacity-70"
        />
      </FieldBox>
    )
  return (
    <FieldBox
      box={field}
      kind={field.kind}
      color={SIGNER_COLOR}
      data-field-id={field.id}
      className="border-dashed bg-transparent! px-1"
      title={translate('filledInWhenYouFinish')}
    >
      <span className="truncate text-[clamp(9px,1.6cqw,14px)] text-[#1c2a4a]">
        {field.kind === 'date' ? today() : name}
      </span>
    </FieldBox>
  )
}

function DeclineDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decline = async () => {
    setBusy(true)
    try {
      const { data } = await signaturesApi.decline(token, reason.trim())
      queryClient.setQueryData(signingKey(token), data)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-2rem))] max-w-none! gap-4 rounded-2xl p-6">
        <div className="grid gap-1">
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
            {translate('declineToSign')}
          </DialogTitle>
          <DialogDescription className="text-[13.5px]">
            {translate('theSenderIsToldWithYourReasonAndNobody')}
          </DialogDescription>
        </div>
        <Textarea
          aria-label={translate('reason')}
          placeholder={translate('eGTheStartDateInClause2Is')}
          rows={4}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {error && <InlineError>{error}</InlineError>}
        <div className="grid grid-cols-2 gap-2">
          <Button size="xl" variant="outline" className="cursor-pointer" onClick={onClose}>
            {translate('keepSigning')}
          </Button>
          <Button
            size="xl"
            variant="destructive"
            className="cursor-pointer"
            disabled={!reason.trim() || busy}
            onClick={() => void decline()}
          >
            {translate('decline')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type Brand = { name: string; logo: string }

function Notice({
  icon: Icon,
  title,
  text,
  tone = 'neutral',
  brand,
}: {
  icon: LucideIcon
  title: string
  text: string
  tone?: Tone
  brand?: Brand
}) {
  return (
    <Shell brand={brand}>
      <span className={cn('flex size-12 items-center justify-center rounded-full', TONES[tone])}>
        <Icon className="size-5 stroke-[1.75]" />
      </span>
      <h1 className="mt-5 text-[19px] font-medium tracking-[-0.01em] text-balance">{title}</h1>
      <p className="mt-2 text-[14px] text-pretty text-muted-foreground">{text}</p>
    </Shell>
  )
}

function Loading() {
  return (
    <Shell>
      <Loader2
        aria-label={translate('loading2')}
        className="size-6 animate-spin text-muted-foreground"
      />
      <p className="mt-4 text-[14px] text-muted-foreground">{translate('openingTheDocument')}</p>
    </Shell>
  )
}

function Shell({ children, brand }: { children: ReactNode; brand?: Brand }) {
  return (
    <div className="flex min-h-svh flex-col items-center bg-muted/50 px-4 dark:bg-background">
      <div className="flex flex-1 items-center">
        <div className="grid max-w-sm justify-items-center rounded-2xl bg-card px-8 py-10 text-center ring-1 ring-foreground/[0.06]">
          {brand && (
            <div className="mb-8 flex max-w-full min-w-0 items-center gap-2.5">
              <BrandMark name={brand.name} logo={brand.logo} />
              <p className="truncate text-sm font-medium">{brand.name}</p>
            </div>
          )}
          {children}
        </div>
      </div>
      <p className="flex items-center gap-1.5 py-6 text-[12px] text-muted-foreground">
        <MailCheck className="size-3.5" />
        {translate('electronicSignaturesByHelvetly')}
      </p>
    </div>
  )
}

/** Up to two initials of a company name, for a workspace without a logo. */
export const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

/** The sending business's logo, as its emails show it; a neutral monogram tile without one (or when it fails). */
function BrandMark({ name, logo }: { name: string; logo: string }) {
  const [broken, setBroken] = useState(false)
  if (logo && !broken)
    return (
      // The email copy of the logo (44 px high, shown at 36); a static export has no image optimiser. Its width
      // is unknown, so both sizes come from CSS (0 x 0 keeps next/image from warning about one changed size).
      <Image
        src={logo}
        alt=""
        width={0}
        height={0}
        unoptimized
        onError={() => setBroken(true)}
        className="h-9 w-auto max-w-32 shrink-0 object-contain"
      />
    )
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground"
    >
      {monogram(name) || '·'}
    </span>
  )
}
