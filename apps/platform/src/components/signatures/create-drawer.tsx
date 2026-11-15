'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Textarea } from '@helvetly/ui/components/textarea'
import { formatDate } from '@helvetly/ui/lib/format'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Building2,
  FileSignature,
  Loader2,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { ApiError, errorMessage } from '@/lib/api'
import { useClientSearch } from '@/lib/clients'
import { contentUrl, refreshDocuments, type DocFile } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import {
  buildCreateBody,
  checkSigners,
  dropSigner,
  FIELD_LABELS,
  signaturesApi,
  signerColor,
  signersWithoutSignature,
  swapSigners,
  titleFromName,
  type DraftField,
  type DraftSigner,
  type FieldKind,
  type SigningOrder,
} from '@/lib/signatures'

import { SesLine, signingPalette } from './parts'
import { DocPreview, PdfPicker } from './pdf-parts'
import { Placement } from './placement'

/** The day links stop working, sent today. */
const expiryDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

const STEPS = [
  translate('document'),
  translate('signers'),
  translate('placeFields'),
  translate('reviewSend'),
] as const

/** A signer row in the wizard: `id` keeps its identity through edits, moves and removals; never sent. */
type SignerRow = DraftSigner & { id: string }
const signerRow = (signer: DraftSigner = { name: '', email: '' }): SignerRow => ({
  ...signer,
  id: crypto.randomUUID(),
})

/** What a signing field's box says before it is signed. */
export const fieldCaption = (field: DraftField) =>
  field.kind === 'text' && field.label ? field.label : FIELD_LABELS[field.kind]

/** The server's field errors as one line, or its message. */
export function serverProblem(error: unknown) {
  const fields =
    error instanceof ApiError && typeof error.details.fields === 'object' && error.details.fields
      ? Object.values(error.details.fields).filter((v): v is string => typeof v === 'string')
      : []
  return fields.length ? fields.join(' ') : errorMessage(error)
}

/** What the step's Next needs before it lets you on, or null. */
export function stepProblem(
  step: number,
  state: { document: DocFile | null; title: string; signers: DraftSigner[]; fields: DraftField[] },
): string | null {
  if (step === 0) {
    if (!state.document) return translate('chooseAPDFToSend')
    if (!state.title.trim()) return translate('giveTheRequestATitle')
  }
  if (step === 1) {
    const check = checkSigners(state.signers)
    if (!check.ok) return check.list || translate('checkTheSignersNamesAndEmailAddresses')
  }
  if (step === 2) {
    const missing = signersWithoutSignature(state.fields, state.signers.length)
    if (missing.length > 0) {
      const names = missing.map(
        (index) => state.signers[index]?.name || translate('signer', { value1: index + 1 }),
      )
      return translate('addASignatureFieldFor', { value1: names.join(', ') })
    }
    if (state.fields.some((field) => field.kind === 'text' && !field.label?.trim()))
      return translate('sayWhatToEnterInEachTextField')
  }
  return null
}

/** Send any PDF for signature: the PDF, who signs, where, then send. */
export function CreateSignatureDrawer({
  initial,
  folderId,
  onClose,
  onSent,
}: {
  /** The PDF it starts from (from a file's menu); null asks for one. */
  initial: DocFile | null
  /** Where an inline upload goes. */
  folderId: string | null
  onClose: () => void
  onSent: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(initial ? 1 : 0)
  const [document, setDocument] = useState<DocFile | null>(initial)
  const [title, setTitle] = useState(initial ? titleFromName(initial.name) : '')
  const [message, setMessage] = useState('')
  const [signers, setSigners] = useState(() => [signerRow()])
  const [order, setOrder] = useState<SigningOrder>('parallel')
  const [days, setDays] = useState(30)
  const [fields, setFields] = useState<DraftField[]>([])
  const [active, setActive] = useState(0)
  const [pages, setPages] = useState(0)
  const [tried, setTried] = useState(false)
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const dirty =
    document !== initial ||
    title !== (initial ? titleFromName(initial.name) : '') ||
    !!message.trim() ||
    signers.some((signer) => signer.name.trim() || signer.email.trim()) ||
    fields.length > 0

  const named = signers.filter((signer) => signer.email.trim()).length
  const summary = [
    document?.name ?? 'No PDF chosen yet',
    named > 0 && `${named} ${named === 1 ? 'signer' : 'signers'}`,
    fields.length > 0 && `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const problem = stepProblem(step, { document, title, signers, fields })
  const next = () => {
    setTried(true)
    if (problem) return
    setTried(false)
    setStep(step + 1)
  }
  const choose = (file: DocFile) => {
    if (file.id !== document?.id) setFields([])
    setDocument(file)
    if (!title.trim() || title === titleFromName(document?.name ?? ''))
      setTitle(titleFromName(file.name))
  }

  const send = async () => {
    if (!document) return
    setSending(true)
    setServerError(null)
    try {
      const { data } = await signaturesApi.create(
        buildCreateBody({
          documentId: document.id,
          title,
          message,
          order,
          expiresInDays: days,
          signers,
          fields,
        }),
      )
      refreshDocuments(queryClient)
      toast.success(
        order === 'sequential'
          ? translate('sentToTheOthersFollowInOrder', { value1: signers[0]?.name })
          : translate('sentForSignatureTo', {
              value1:
                signers.length === 1
                  ? signers[0]?.name
                  : translate('people2', { length: signers.length }),
            }),
      )
      onSent(data.id)
    } catch (error) {
      setServerError(serverProblem(error))
    } finally {
      setSending(false)
    }
  }

  const preview = (
    <DocPreview
      document={document}
      fields={fields}
      caption={fieldCaption}
      pages={pages}
      onPages={setPages}
    />
  )

  return (
    <WizardSheet
      icon={<FileSignature />}
      title={title.trim() || translate('pdfForSignature2')}
      steps={STEPS}
      step={step}
      onStep={setStep}
      dirty={dirty}
      busy={sending}
      discardTitle={translate('discardThisRequest')}
      onClose={onClose}
      status={summary}
      error={serverError ?? (tried ? problem : null)}
      action={
        step < STEPS.length - 1 ? (
          <Button className="cursor-pointer" onClick={next}>
            {translate('next2')}
          </Button>
        ) : (
          <Button className="cursor-pointer gap-1.5" disabled={sending} onClick={() => void send()}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {translate('sendForSignature2')}
          </Button>
        )
      }
    >
      {step === 0 && (
        <Split preview={preview}>
          <StepTitle
            title={translate('whatShouldBeSigned')}
            text={translate('aPDFFromDocumentsWhatYouSendIsFrozen')}
          />
          <PdfPicker document={document} folderId={folderId} onChoose={choose} />
          <MessageFields
            title={title}
            onTitle={setTitle}
            message={message}
            onMessage={setMessage}
            tried={tried}
          />
          <SesLine />
        </Split>
      )}
      {step === 1 && (
        <Split preview={preview}>
          <SignersStep
            signers={signers}
            onSigners={(list, change) => {
              setSigners(list)
              if (change?.removed !== undefined) {
                setFields(dropSigner(fields, change.removed))
                setActive(0)
              }
              if (change?.swapped) setFields(swapSigners(fields, ...change.swapped))
            }}
            order={order}
            onOrder={setOrder}
            days={days}
            onDays={setDays}
            tried={tried}
          />
        </Split>
      )}
      {step === 2 && document && (
        <Placement
          src={contentUrl(document.id)}
          title={document.name}
          palette={{ ...signingPalette, lanes: signers }}
          fields={fields}
          onFields={setFields}
          active={Math.min(active, signers.length - 1)}
          onActive={setActive}
          onPages={setPages}
        />
      )}
      {step === 3 && document && (
        <Split preview={preview}>
          <ReviewStep
            document={document}
            title={title}
            message={message}
            signers={signers}
            order={order}
            days={days}
            fields={fields}
            pages={pages}
          />
        </Split>
      )}
    </WizardSheet>
  )
}

/** The request's title and the message in the email and on the signing page. */
export function MessageFields({
  title,
  onTitle,
  message,
  onMessage,
  tried,
}: {
  title: string
  onTitle: (title: string) => void
  message: string
  onMessage: (message: string) => void
  tried: boolean
}) {
  return (
    <>
      <FormField
        id="sig-title"
        label={translate('title')}
        required
        error={tried && !title.trim() ? translate('enterATitle2') : undefined}
      >
        <Input
          id="sig-title"
          value={title}
          maxLength={200}
          onChange={(event) => onTitle(event.target.value)}
        />
      </FormField>
      <FormField
        id="sig-message"
        label={translate('message')}
        tip={translate('shownInTheEmailAndOnTheSigningPage')}
      >
        <Textarea
          id="sig-message"
          value={message}
          maxLength={2000}
          rows={4}
          placeholder={translate('helloPleaseReviewAndSignTheAttachedAgreement')}
          onChange={(event) => onMessage(event.target.value)}
        />
      </FormField>
    </>
  )
}

// ---- step 2: signers ----

type SignerChange = { removed?: number; swapped?: [number, number] }

function SignersStep({
  signers,
  onSigners,
  order,
  onOrder,
  days,
  onDays,
  tried,
}: {
  signers: SignerRow[]
  onSigners: (signers: SignerRow[], change?: SignerChange) => void
  order: SigningOrder
  onOrder: (order: SigningOrder) => void
  days: number
  onDays: (days: number) => void
  tried: boolean
}) {
  const check = checkSigners(signers)
  const set = (index: number, change: Partial<DraftSigner>) =>
    onSigners(signers.map((signer, i) => (i === index ? { ...signer, ...change } : signer)))
  const swap = (a: number, b: number) => {
    const next = [...signers]
    const [first, second] = [next[a], next[b]]
    if (!first || !second) return
    next[a] = second
    next[b] = first
    onSigners(next, { swapped: [a, b] })
  }
  const addPerson = (person: DraftSigner) => {
    const blank = signers.findIndex((signer) => !signer.name.trim() && !signer.email.trim())
    if (signers.some((signer) => signer.email.trim().toLowerCase() === person.email.toLowerCase()))
      return
    onSigners(
      blank >= 0
        ? signers.map((s, i) => (i === blank ? { ...s, ...person } : s))
        : [...signers, signerRow(person)],
    )
  }

  return (
    <>
      <StepTitle
        title={translate('whoSigns')}
        text={translate('eachSignerGetsTheirOwnLinkByEmailNobody')}
      />
      <section className="grid gap-2">
        <ol className="grid gap-2">
          {signers.map((signer, index) => {
            const row = check.rows[index]
            return (
              <li key={signer.id} className="flex items-start gap-2 rounded-xl border p-2.5">
                <span
                  className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white tabular-nums"
                  style={{ backgroundColor: signerColor(index) }}
                >
                  {index + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Input
                      aria-label={translate('signerName', { value1: index + 1 })}
                      placeholder={translate('fullName')}
                      value={signer.name}
                      maxLength={200}
                      aria-invalid={tried && !!row?.name}
                      onChange={(event) => set(index, { name: event.target.value })}
                    />
                    {tried && row?.name && <p className="text-xs text-destructive">{row.name}</p>}
                  </div>
                  <div className="grid gap-1">
                    <Input
                      type="email"
                      aria-label={translate('signerEmail', { value1: index + 1 })}
                      placeholder={translate('nameCompanyCh')}
                      value={signer.email}
                      aria-invalid={tried && !!row?.email}
                      onChange={(event) => set(index, { email: event.target.value })}
                    />
                    {tried && row?.email && <p className="text-xs text-destructive">{row.email}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('moveUp2')}
                    disabled={index === 0}
                    className="cursor-pointer"
                    onClick={() => swap(index, index - 1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('moveDown2')}
                    disabled={index === signers.length - 1}
                    className="cursor-pointer"
                    onClick={() => swap(index, index + 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="destructive-ghost"
                    size="icon-sm"
                    aria-label={translate('removeSigner', { value1: index + 1 })}
                    disabled={signers.length === 1}
                    className="cursor-pointer"
                    onClick={() =>
                      onSigners(
                        signers.filter((_, i) => i !== index),
                        { removed: index },
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="cursor-pointer gap-1.5"
            disabled={signers.length >= 10}
            onClick={() => onSigners([...signers, signerRow()])}
          >
            <Plus className="size-4" />
            {translate('addSigner')}
          </Button>
          <ContactPicker onPick={addPerson} disabled={signers.length >= 10} />
        </div>
      </section>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium">{translate('signingOrder')}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
          {(
            [
              ['parallel', 'Everyone at once', 'All signers get their link now.'],
              [
                'sequential',
                'One after another',
                'Each gets their link when the one before has signed.',
              ],
            ] as const
          ).map(([value, label, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => onOrder(value)}
              className="grid cursor-pointer gap-0.5 rounded-lg px-3 py-2 text-left transition-colors aria-pressed:bg-card aria-pressed:shadow-elevation-1"
            >
              <span className="text-[13.5px] font-medium">{label}</span>
              <span className="text-[12px] text-muted-foreground">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <FormField
        id="sig-days"
        label={translate('expiresAfter')}
        hint={translate('linksStopWorkingOn', { value1: formatDate(expiryDate(days)) })}
      >
        <div className="flex items-center gap-2">
          <Input
            id="sig-days"
            type="number"
            min={1}
            max={365}
            value={days}
            className="w-24"
            onChange={(event) =>
              onDays(Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1))))
            }
          />
          <span className="text-sm text-muted-foreground">{translate('days')}</span>
        </div>
      </FormField>
    </>
  )
}

/** Clients' contacts (and the client's own address) with an email, to add as signers. */
function ContactPicker({
  onPick,
  disabled,
}: {
  onPick: (person: DraftSigner) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const search = useClientSearch(term, open)
  const people = (search.data?.data ?? []).flatMap((client) => {
    const list = client.contacts
      .filter((contact) => contact.email)
      .map((contact) => ({
        key: contact.id,
        name: contact.name,
        email: contact.email ?? '',
        detail: [contact.role, client.name].filter(Boolean).join(' · '),
      }))
    if (client.email && !client.contacts.some((contact) => contact.email === client.email))
      list.push({
        key: client.id,
        name: client.name,
        email: client.email,
        detail: translate('client6', { number: client.number }),
      })
    return list
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="cursor-pointer gap-1.5" disabled={disabled}>
          <Building2 className="size-4" />
          {translate('fromClients')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-1.5">
        <label className="flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground">
          <Search className="size-4 shrink-0" />
          <input
            aria-label={translate('searchClients')}
            placeholder={translate('searchClients')}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
          />
        </label>
        <div className="max-h-64 overflow-y-auto">
          {people.length === 0 ? (
            <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">
              {search.isPending
                ? translate('searching')
                : translate('noContactsWithAnEmailAddress')}
            </p>
          ) : (
            people.map((person) => (
              <button
                key={person.key}
                type="button"
                onClick={() => {
                  onPick({ name: person.name, email: person.email })
                  setOpen(false)
                }}
                className="grid w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="truncate text-sm">{person.name}</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {person.email} · {person.detail}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---- step 4: review ----

function ReviewStep({
  document,
  title,
  message,
  signers,
  order,
  days,
  fields,
  pages,
}: {
  document: DocFile
  title: string
  message: string
  signers: SignerRow[]
  order: SigningOrder
  days: number
  fields: DraftField[]
  pages: number
}) {
  const counts = (index: number) => {
    const own = fields.filter((field) => field.signer === index)
    return (['signature', 'date', 'name', 'text'] as FieldKind[])
      .map((kind) => [kind, own.filter((field) => field.kind === kind).length] as const)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${n} × ${FIELD_LABELS[kind].toLowerCase()}`)
      .join(', ')
  }
  return (
    <>
      <StepTitle
        title={translate('readyToSend')}
        text={translate('checkEverythingOnceMoreASentRequestCanT')}
      />
      <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 rounded-xl border p-4 text-[13.5px]">
        <dt className="text-muted-foreground">{translate('title')}</dt>
        <dd className="font-medium">{title.trim()}</dd>
        <dt className="text-muted-foreground">{translate('document')}</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="truncate">{document.name}</span>
          {pages > 0 && (
            <span className="shrink-0 text-muted-foreground">
              · {pages}
              {translate('pages2')}
            </span>
          )}
        </dd>
        {message.trim() && (
          <>
            <dt className="text-muted-foreground">{translate('message')}</dt>
            <dd className="whitespace-pre-line">{message.trim()}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{translate('order')}</dt>
        <dd>{order === 'parallel' ? translate('everyoneAtOnce') : translate('oneAfterAnother')}</dd>
        <dt className="text-muted-foreground">{translate('expires')}</dt>
        <dd>
          {translate('in2')}
          {days}
          {translate('days6')}
          {formatDate(expiryDate(days))})
        </dd>
      </dl>
      <section className="grid gap-2">
        <h3 className="text-[12px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
          {translate('signers')}
        </h3>
        <ol className="grid gap-1.5">
          {signers.map((signer, index) => (
            <li key={signer.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: signerColor(index) }}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{signer.name.trim()}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {signer.email.trim()}
                </span>
              </span>
              <span className="text-right text-[12px] text-muted-foreground">{counts(index)}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="text-[13px] text-pretty text-muted-foreground">
        {translate('whenEveryoneHasSignedTheSignedPDFWithA')}
      </p>
      <SesLine />
    </>
  )
}
