'use client'
import { locale } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { formatDate } from '@helvetly/ui/lib/format'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, FileSignature, FileText, LayoutTemplate, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { EmailComposer, EmailLanguageField, EmailPreviewPane } from '@/components/email-composer'
import { useOpenHref } from '@/components/record-link'
import {
  Choice,
  ClientPicker,
  templateCaption,
  TemplatePicker,
  ValueFields,
} from '@/components/templates/fill-parts'
import { failed, Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import type { Client } from '@/lib/clients'
import { contentUrl, refreshDocuments, useDoc, type DocFile } from '@/lib/documents'
import {
  emailLanguage,
  useEmailPreview,
  useTemplateDraft,
  type EmailLanguage,
} from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
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
import {
  defaultSigners,
  generateProblem,
  initialValues,
  isDataKind,
  ROLE_LANE,
  templatesApi,
  toDraftFields,
  useTemplateMutation,
  valueKey,
  valuesByField,
  type GenerateRequest,
  type Template,
  type TemplateDraftField,
} from '@/lib/templates'

import { SesLine, signingPalette } from './parts'
import { DocPreview, PdfPicker } from './pdf-parts'
import { Placement } from './placement'
import {
  clientSigner,
  expiryDate,
  SignersStep,
  signerRow,
  type SignerChange,
  type SignerRow,
} from './signers-step'

/** What is signed: any PDF, or a template filled for a client. */
export type Source = 'pdf' | 'template'
export type StepId = 'document' | 'fill' | 'signers' | 'place' | 'message' | 'review'

const STEP_LABELS: Record<StepId, string> = {
  document: translate('document'),
  fill: translate('fillIn'),
  signers: translate('signers'),
  place: translate('placeFields'),
  message: translate('message'),
  review: translate('reviewSend'),
}

/** The steps: a template adds Fill in, and needs Place fields only when it has no signing fields. */
export function stepsFor(source: Source, template: Template | null): StepId[] {
  if (source === 'pdf') return ['document', 'signers', 'place', 'message', 'review']
  const place: StepId[] = template && template.signers.length > 0 ? [] : ['place']
  return ['document', 'fill', 'signers', ...place, 'message', 'review']
}

/** What a signing field's box says before it is signed. */
export const fieldCaption = (field: DraftField) =>
  field.kind === 'text' && field.label ? field.label : FIELD_LABELS[field.kind]

type StepState = {
  source: Source
  document: DocFile | null
  template: Template | null
  client: Client | null
  values: Record<string, string>
  title: string
  signers: DraftSigner[]
  fields: DraftField[]
}

/** What the step's Next needs before it lets you on, or null. */
export function stepProblem(step: StepId, state: StepState): string | null {
  const fill = { ...state, delivery: 'signature' as const, emailTo: '' }
  if (step === 'document') {
    if (state.source === 'template') return generateProblem(0, fill)
    return state.document ? null : translate('chooseAPDFToSend')
  }
  if (step === 'fill') return generateProblem(1, fill)
  if (step === 'message' && !state.title.trim()) return translate('giveTheRequestATitle')
  if (step === 'signers') {
    const check = checkSigners(state.signers)
    if (!check.ok) return check.list || translate('checkTheSignersNamesAndEmailAddresses')
  }
  if (step === 'place') {
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

/** Send a PDF, or a template filled for a client, for signature: what, who signs, where, then send. */
export function CreateSignatureDrawer({
  initial,
  client: initialClient = null,
  folderId,
  onClose,
  onSent,
}: {
  /** The PDF it starts from (from a file's menu); null asks what to sign. */
  initial: DocFile | null
  /** Opened from a client: its main contact signs, and a template is filled for it. */
  client?: Client | null
  /** Where an inline upload goes. */
  folderId: string | null
  onClose: () => void
  onSent: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<Source>('pdf')
  const [step, setStep] = useState(initial ? 1 : 0)
  const [document, setDocument] = useState<DocFile | null>(initial)
  const [template, setTemplate] = useState<Template | null>(null)
  const [client, setClient] = useState<Client | null>(initialClient)
  const [changingClient, setChangingClient] = useState(!initialClient)
  // What the later steps were filled for; another template or client starts them over.
  const [preparedFor, setPreparedFor] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [title, setTitle] = useState(initial ? titleFromName(initial.name) : '')
  const session = useSession().data
  const [language, setLanguage] = useState<EmailLanguage>(
    emailLanguage(initialClient?.language, emailLanguage(locale)),
  )
  const [signers, setSigners] = useState<SignerRow[]>(() => {
    const first = initialClient && clientSigner(initialClient)
    return first ? [first] : []
  })
  const [order, setOrder] = useState<SigningOrder>('parallel')
  const [days, setDays] = useState(30)
  const [fields, setFields] = useState<DraftField[]>([])
  const [active, setActive] = useState(0)
  const [pages, setPages] = useState(0)
  const [tried, setTried] = useState(false)
  const [sending, setSending] = useState(false)
  const generate = useTemplateMutation((input: { id: string; body: GenerateRequest }) =>
    templatesApi.generate(input.id, input.body),
  )
  const steps = stepsFor(source, template)
  const at = steps[Math.min(step, steps.length - 1)] ?? 'document'
  const fromTemplate = source === 'template' && template !== null
  // A template with signing roles: one signer per role, sent with the template's own fields.
  const roles = fromTemplate && template.signers.length > 0
  const draft = useTemplateDraft('signature_request', language, {
    document: title.trim(),
    sender: session?.user.name || session?.user.email || '',
    company: session?.workspace.name ?? '',
  })
  const message = draft.message
  const emailPreview = useEmailPreview(
    '/signatures/email-preview',
    { title, message, language, expires_in_days: days },
    at === 'message',
  )
  const dirty =
    document !== initial ||
    template !== null ||
    title !== (initial ? titleFromName(initial.name) : '') ||
    draft.touched ||
    signers.length > (initialClient ? 1 : 0) ||
    fields.length > 0

  const named = signers.filter((signer) => signer.email.trim()).length
  const summary = [
    fromTemplate
      ? [template.name, client?.name].filter(Boolean).join(' · ')
      : (document?.name ?? translate('noPdfChosenYet')),
    named > 0 && `${named} ${named === 1 ? 'signer' : 'signers'}`,
    fields.length > 0 && `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const problem = stepProblem(at, {
    source,
    document,
    template,
    client,
    values,
    title,
    signers,
    fields,
  })

  /** Fills the later steps for the chosen template and client. */
  const prepare = (chosen: Template, forClient: Client) => {
    setPreparedFor(`${chosen.id}:${forClient.id}`)
    setTitle(`${chosen.name} – ${forClient.name}`)
    setValues(initialValues(chosen, forClient, new Date()))
    setLanguage(emailLanguage(forClient.language, emailLanguage(locale)))
    setFields([])
    setActive(0)
    if (chosen.signers.length > 0) {
      const people = defaultSigners(chosen, forClient)
      setSigners(chosen.signers.map((role, index) => signerRow(people[index], role.label)))
    } else {
      const first = clientSigner(forClient)
      setSigners(first ? [first] : [])
    }
  }
  const next = () => {
    setTried(true)
    if (problem) return
    setTried(false)
    if (at === 'document' && source === 'template' && template && client)
      if (`${template.id}:${client.id}` !== preparedFor) prepare(template, client)
    setStep(step + 1)
  }
  const choose = (file: DocFile) => {
    if (file.id !== document?.id) setFields([])
    setDocument(file)
    if (!title.trim() || title === titleFromName(document?.name ?? ''))
      setTitle(titleFromName(file.name))
  }
  const onSigners = (list: SignerRow[], change?: SignerChange) => {
    setSigners(list)
    if (change?.removed !== undefined) {
      setFields(dropSigner(fields, change.removed))
      setActive(0)
    }
    if (change?.swaps)
      setFields(change.swaps.reduce((moved, pair) => swapSigners(moved, ...pair), fields))
  }

  /** A PDF, or a template's filed document, sent with the fields placed here. */
  const sendPlaced = async (documentId: string) => {
    const { data } = await signaturesApi.create(
      buildCreateBody({
        documentId,
        title,
        message,
        language,
        order,
        expiresInDays: days,
        signers,
        fields,
      }),
    )
    return data.id
  }
  /** A template with roles is sent as it is; one without is filed first, then sent with the fields placed here. */
  const sendTemplate = async (chosen: Template, forClient: Client) => {
    const base = {
      client_id: forClient.id,
      title: title.trim(),
      values: valuesByField(chosen, values),
    }
    const body: GenerateRequest = roles
      ? {
          ...base,
          delivery: {
            type: 'signature',
            signers: signers.map((signer) => ({
              name: signer.name.trim(),
              email: signer.email.trim().toLowerCase(),
            })),
            message: message.trim() || null,
            language,
            signing_order: order,
            expires_in_days: days,
          },
        }
      : { ...base, delivery: { type: 'save' } }
    const { data } = await generate.mutateAsync({ id: chosen.id, body })
    return roles ? data.signature_request_id : sendPlaced(data.document.id)
  }
  const send = async () => {
    setSending(true)
    try {
      const id = fromTemplate
        ? client && (await sendTemplate(template, client))
        : document && (await sendPlaced(document.id))
      if (!id) return
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
      onSent(id)
    } catch (error) {
      failed(translate('couldNotSendForSignature'), error)
    } finally {
      setSending(false)
    }
  }

  // The template's own fields (its data printed once a client fills them) plus the signing fields placed here.
  const templateFields: TemplateDraftField[] = fromTemplate
    ? [
        ...toDraftFields(template),
        ...fields.map((field) => ({ ...field, signer: field.signer + ROLE_LANE })),
      ]
    : []
  const printed = (field: TemplateDraftField) =>
    at !== 'document' && isDataKind(field.kind)
      ? (values[valueKey({ id: field.key, kind: field.kind })] ?? '')
      : null
  const preview = fromTemplate ? (
    <DocPreview
      document={template.document}
      fields={templateFields}
      caption={templateCaption}
      printed={printed}
      pages={pages}
      onPages={setPages}
    />
  ) : (
    <DocPreview
      document={source === 'pdf' ? document : null}
      fields={fields}
      caption={fieldCaption}
      pages={pages}
      onPages={setPages}
      empty={
        source === 'template'
          ? translate('chooseATemplateToSeeItHere')
          : translate('chooseAPDFToSeeItHere')
      }
    />
  )
  const placing = fromTemplate ? template.document : document

  return (
    <WizardSheet
      icon={<FileSignature />}
      title={title.trim() || translate('sendForSignature2')}
      steps={steps.map((id) => STEP_LABELS[id])}
      step={step}
      onStep={setStep}
      dirty={dirty}
      busy={sending}
      discardTitle={translate('discardThisRequest')}
      onClose={onClose}
      status={summary}
      error={tried ? problem : null}
      action={
        at !== 'review' ? (
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
      {at === 'document' && (
        <Split preview={preview}>
          <StepTitle
            title={translate('whatShouldBeSigned')}
            text={
              source === 'pdf'
                ? translate('aPDFFromDocumentsWhatYouSendIsFrozen')
                : translate('signFromTemplateText')
            }
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice
              icon={FileText}
              label={translate('signSourcePdf')}
              text={translate('signSourcePdfText')}
              selected={source === 'pdf'}
              onPick={() => setSource('pdf')}
            />
            <Choice
              icon={LayoutTemplate}
              label={translate('signSourceTemplate')}
              text={translate('signSourceTemplateText')}
              selected={source === 'template'}
              onPick={() => setSource('template')}
            />
          </div>
          {source === 'pdf' ? (
            <PdfPicker document={document} folderId={folderId} onChoose={choose} />
          ) : (
            <>
              <TemplatePicker selected={template} onPick={setTemplate} />
              {changingClient || !client ? (
                <ClientPicker selected={client} onPick={setClient} />
              ) : (
                <p className="flex min-w-0 items-center gap-2 text-body">
                  <Building2 className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
                  <span className="min-w-0 truncate">
                    {translate('forClient', { name: client.name })}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded-sm text-body-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => setChangingClient(true)}
                  >
                    {translate('change')}
                  </button>
                </p>
              )}
            </>
          )}
          <SesLine />
        </Split>
      )}
      {at === 'fill' && fromTemplate && (
        <Split preview={preview}>
          <StepTitle
            title={translate('checkTheDetails')}
            text={translate('takenFromTheClientChangesHereGoIntoThis')}
          />
          <ValueFields
            template={template}
            values={values}
            tried={tried}
            onChange={(key, value) => setValues({ ...values, [key]: value })}
          />
        </Split>
      )}
      {at === 'signers' && (
        <Split preview={preview}>
          <SignersStep
            signers={signers}
            onSigners={onSigners}
            order={order}
            onOrder={setOrder}
            days={days}
            onDays={setDays}
            tried={tried}
            fixed={roles}
          />
        </Split>
      )}
      {at === 'place' && placing && (
        <Placement
          src={contentUrl(placing.id)}
          title={placing.name}
          palette={{ ...signingPalette, lanes: signers }}
          fields={fields}
          onFields={setFields}
          active={Math.min(active, signers.length - 1)}
          onActive={setActive}
          onPages={setPages}
        />
      )}
      {at === 'message' && (
        <Split
          preview={
            <EmailPreviewPane preview={emailPreview.data} pending={emailPreview.isPending} />
          }
        >
          <StepTitle
            title={translate('theEmailToTheSigners')}
            text={translate('eachSignerGetsThisEmailWithTheirOwnLink')}
          />
          <EmailLanguageField id="sig-language" value={language} onChange={setLanguage} />
          <EmailComposer
            id="sig"
            subjectLabel={translate('title')}
            subject={title}
            onSubject={setTitle}
            message={message}
            onMessage={draft.setMessage}
            disabled={draft.loading}
            errors={tried && !title.trim() ? { subject: translate('enterATitle2') } : {}}
            language={language}
            context={{ document: title, signers: signers.map((s) => s.name).join(', ') }}
          />
          <SesLine />
        </Split>
      )}
      {at === 'review' && placing && (
        <Split preview={preview}>
          <ReviewStep
            document={placing}
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
  document: { id: string; name: string }
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

/** Sends a filed document (a contract) for signature with this drawer, once its file is loaded. */
export function ContractSignDrawer({
  documentId,
  onClose,
}: {
  documentId: string
  onClose: () => void
}) {
  const openHref = useOpenHref()
  const doc = useDoc(documentId).data
  if (!doc) return null
  return (
    <CreateSignatureDrawer
      initial={doc}
      folderId={null}
      onClose={onClose}
      onSent={(id) => {
        onClose()
        openHref(`/documents?${new URLSearchParams({ view: 'signatures', request: id })}`)
      }}
    />
  )
}
