'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { segmentLabels } from '@helvetly/ui/components/segmented'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { formatRelative } from '@helvetly/ui/lib/format'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  Check,
  FileDown,
  FileSignature,
  LayoutTemplate,
  Loader2,
  Mail,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAIApproval } from '@/components/ai/ai-approval'
import { fieldCaption, serverProblem } from '@/components/signatures/create-drawer'
import { SesLine } from '@/components/signatures/parts'
import { DocPreview } from '@/components/signatures/pdf-parts'
import { Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { useClientSearch, type Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { checkSigners, signerColor, type DraftSigner, type SigningOrder } from '@/lib/signatures'
import {
  DATA_LABELS,
  defaultSigners,
  generateProblem,
  initialValues,
  isDataKind,
  primaryContact,
  templatesApi,
  toDraftFields,
  useTemplateMutation,
  useTemplates,
  valueKey,
  valuesByField,
  type ContractDraft,
  type DeliveryType,
  type Generated,
  type GenerateRequest,
  type Template,
  type TemplateDraftField,
  ROLE_LANE,
} from '@/lib/templates'

const STEPS = [translate('templateClient'), translate('fillIn'), translate('send')] as const

/** What a box says before a client fills it: the field's kind or label. */
function caption(field: TemplateDraftField) {
  if (field.kind === 'signature' || field.kind === 'date' || field.kind === 'name')
    return fieldCaption({ ...field, kind: field.kind })
  if (field.kind === 'text') return field.label || translate('text')
  return field.kind === 'custom' ? field.label : DATA_LABELS[field.kind]
}

/**
 * A contract made from a quote: its client is the quote's, the template's own fields are filled from
 * the quote (by name, the rest by the AI model), and the document is numbered and linked to the quote.
 */
export type ContractSource = {
  quoteId: string
  quoteNumber: string | null
  /** "Use a file from Documents": make a template of a file first. */
  onFromDocument: () => void
  /** Made: the host shows the toast with its actions. */
  onMade: (made: Generated) => void
}

/** What the drawer says about how the quote's details were filled. */
const AI_NOTES: Partial<Record<ContractDraft['ai'], string>> = {
  unavailable: translate('contractAiUnavailable'),
  skipped: translate('contractAiSkipped'),
  quota_exceeded: translate('contractAiQuota'),
  failed: translate('contractAiFailed'),
}

/**
 * Make a document from a template for one client: the client's details fill the template, then it
 * is saved to Documents, emailed, or (when the template asks for signatures) sent to sign.
 */
export function FillTemplateDrawer({
  template: initialTemplate,
  client: initialClient,
  contract,
  onClose,
}: {
  template: Template | null
  client: Client | null
  contract?: ContractSource
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [template, setTemplate] = useState(initialTemplate)
  const [client, setClient] = useState(initialClient)
  // What the later steps were filled for; choosing another template or client starts them over.
  const [preparedFor, setPreparedFor] = useState('')
  const [title, setTitle] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [delivery, setDelivery] = useState<DeliveryType>('save')
  const [emailTo, setEmailTo] = useState('')
  const [message, setMessage] = useState('')
  const [signers, setSigners] = useState<DraftSigner[]>([])
  const [order, setOrder] = useState<SigningOrder>('parallel')
  const [pages, setPages] = useState(0)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // A contract: where each field's value came from (quote or AI), and how the AI went.
  const [sources, setSources] = useState<ContractDraft['sources']>({})
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const { ensure } = useAIApproval()
  const generate = useTemplateMutation((input: { id: string; body: GenerateRequest }) =>
    templatesApi.generate(input.id, input.body),
  )

  const state = { template, client, title, values, delivery, emailTo, signers }
  const problem = generateProblem(step, state)
  const dirty = preparedFor !== '' && step > 0

  const prepare = (chosen: Template, forClient: Client, draft: ContractDraft | null) => {
    setPreparedFor(`${chosen.id}:${forClient.id}`)
    setTitle(
      contract
        ? translate('contractWith', { client: forClient.name })
        : `${chosen.name} – ${forClient.name}`,
    )
    setValues({ ...initialValues(chosen, forClient, new Date()), ...draft?.fields })
    setSources(draft?.sources ?? {})
    setAiNote(draft ? (AI_NOTES[draft.ai] ?? null) : null)
    setDelivery(chosen.signers.length > 0 ? 'signature' : 'save')
    setEmailTo(primaryContact(forClient)?.email ?? forClient.email ?? '')
    setSigners(defaultSigners(chosen, forClient))
  }
  // The quote's details for the template's fields; the model only with the person's approval.
  const contractDraft = async (templateId: string) => {
    if (!contract) return null
    setDrafting(true)
    setServerError(null)
    try {
      const useAI = await ensure()
      const body = { template_id: templateId, use_ai: useAI }
      return (await templatesApi.contractDraft(contract.quoteId, body)).data
    } catch (error) {
      setServerError(serverProblem(error))
      return null
    } finally {
      setDrafting(false)
    }
  }
  const next = async () => {
    setTried(true)
    if (problem) return
    setTried(false)
    if (step === 0 && template && client && `${template.id}:${client.id}` !== preparedFor) {
      const draft = contract ? await contractDraft(template.id) : null
      if (contract && !draft) return
      prepare(template, client, draft)
    }
    setStep(step + 1)
  }

  const send = () => {
    setTried(true)
    if (problem || !template || !client) return
    setServerError(null)
    const body: GenerateRequest = {
      client_id: client.id,
      ...(contract && { quote_id: contract.quoteId }),
      title: title.trim(),
      values: valuesByField(template, values),
      delivery:
        delivery === 'email'
          ? { type: 'email', to: emailTo.trim().toLowerCase(), message: message.trim() || null }
          : delivery === 'signature'
            ? {
                type: 'signature',
                signers: signers.map((signer) => ({
                  name: signer.name.trim(),
                  email: signer.email.trim().toLowerCase(),
                })),
                message: message.trim() || null,
                signing_order: order,
                expires_in_days: 30,
              }
            : { type: 'save' },
    }
    generate.mutate(
      { id: template.id, body },
      {
        onSuccess: ({ data }) => {
          if (contract) {
            contract.onMade(data)
            return onClose()
          }
          toast.success(
            data.signature_request_id
              ? translate('sentForSignature', { name: data.document.name })
              : data.emailed_to
                ? translate('emailedTo', { name: data.document.name, emailed_to: data.emailed_to })
                : translate('savedToDocuments', { name: data.document.name }),
          )
          onClose()
        },
        onError: (error) => setServerError(serverProblem(error)),
      },
    )
  }

  const draftFields = template ? toDraftFields(template) : []
  // Once a client is chosen, data fields show their values as the generated PDF prints them.
  const printed = (field: TemplateDraftField) =>
    step > 0 && isDataKind(field.kind)
      ? (values[valueKey({ id: field.key, kind: field.kind })] ?? '')
      : null
  const preview = (
    <DocPreview
      document={template?.document ?? null}
      fields={draftFields}
      caption={caption}
      printed={printed}
      pages={pages}
      onPages={setPages}
      empty={translate('chooseATemplateToSeeItHere')}
    />
  )
  const actionLabel =
    delivery === 'signature'
      ? translate('sendForSignature2')
      : delivery === 'email'
        ? translate('sendEmail')
        : translate('saveToDocuments')

  return (
    <WizardSheet
      icon={contract ? <Sparkles /> : <LayoutTemplate />}
      title={
        step > 0 && title.trim()
          ? title.trim()
          : contract
            ? translate('createContractWithAI')
            : translate('newDocumentFromATemplate')
      }
      steps={STEPS}
      step={step}
      onStep={setStep}
      dirty={dirty}
      busy={generate.isPending || drafting}
      discardTitle={translate('discardThisDocument')}
      onClose={onClose}
      status={[template?.name ?? 'No template chosen', client?.name].filter(Boolean).join(' · ')}
      error={serverError ?? (tried ? problem : null)}
      action={
        step < STEPS.length - 1 ? (
          <Button
            className="cursor-pointer gap-1.5"
            disabled={drafting}
            onClick={() => void next()}
          >
            {drafting && <Loader2 className="size-4 animate-spin" />}
            {drafting ? translate('fillingFromTheQuote') : translate('next2')}
          </Button>
        ) : (
          <Button className="cursor-pointer gap-1.5" disabled={generate.isPending} onClick={send}>
            {generate.isPending && <Loader2 className="size-4 animate-spin" />}
            {actionLabel}
          </Button>
        )
      }
    >
      {step === 0 && (
        <Split preview={preview}>
          {contract ? (
            <StepTitle
              title={translate('whichTemplate')}
              text={translate('theQuoteFillsTheTemplate', {
                number: contract.quoteNumber ?? translate('draft'),
              })}
            />
          ) : (
            <StepTitle
              title={translate('whichTemplateForWhom')}
              text={translate('theClientSNameAddressAndContactFillThe')}
            />
          )}
          <TemplatePicker
            selected={template}
            onPick={setTemplate}
            onFromDocument={contract?.onFromDocument}
          />
          {!contract && <ClientPicker selected={client} onPick={setClient} />}
        </Split>
      )}
      {step === 1 && template && (
        <Split preview={preview}>
          <StepTitle
            title={translate('checkTheDetails')}
            text={translate('takenFromTheClientChangesHereGoIntoThis')}
          />
          {aiNote && <p className="text-body-sm text-muted-foreground">{aiNote}</p>}
          <FormField
            id="fill-title"
            label={translate('documentTitle')}
            required
            tip={
              contract
                ? translate('theFileIsNamedAfterTheContractNumber')
                : translate('alsoItsFileNameInDocuments')
            }
          >
            <Input
              id="fill-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <ValueFields
            template={template}
            values={values}
            sources={sources}
            quoteNumber={contract?.quoteNumber ?? null}
            tried={tried}
            onChange={(key, value) => setValues({ ...values, [key]: value })}
          />
        </Split>
      )}
      {step === 2 && template && (
        <Split preview={preview}>
          <StepTitle
            title={translate('whatShouldHappenWithIt')}
            text={translate('itIsSavedToDocumentsNextToTheClient')}
          />
          <div className="grid gap-2">
            <Choice
              icon={FileDown}
              label={translate('saveToDocuments')}
              text={translate('keepItSendItYourselfLater')}
              selected={delivery === 'save'}
              onPick={() => setDelivery('save')}
            />
            <Choice
              icon={Mail}
              label={translate('emailItToTheClient')}
              text={translate('asAPDFAttachmentFromYourWorkspace')}
              selected={delivery === 'email'}
              onPick={() => setDelivery('email')}
            />
            <Choice
              icon={FileSignature}
              label={translate('sendForSignature2')}
              text={
                template.signers.length > 0
                  ? translate('eachSignerGetsALinkToSignOnline')
                  : translate('thisTemplateHasNoSigningFieldsAddThemIn')
              }
              selected={delivery === 'signature'}
              disabled={template.signers.length === 0}
              onPick={() => setDelivery('signature')}
            />
          </div>
          {delivery === 'email' && (
            <FormField id="fill-to" label={translate('to3')} required>
              <Input
                id="fill-to"
                type="email"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
              />
            </FormField>
          )}
          {delivery === 'signature' && (
            <RoleSigners
              template={template}
              signers={signers}
              onSigners={setSigners}
              order={order}
              onOrder={setOrder}
              tried={tried}
            />
          )}
          {delivery !== 'save' && (
            <FormField
              id="fill-message"
              label={translate('message')}
              hint={
                delivery === 'signature'
                  ? translate('shownInTheEmailAndOnTheSigningPage')
                  : undefined
              }
            >
              <Textarea
                id="fill-message"
                value={message}
                maxLength={2000}
                rows={4}
                placeholder={translate('helloPleaseFindTheDocumentAttached')}
                onChange={(event) => setMessage(event.target.value)}
              />
            </FormField>
          )}
          {delivery === 'signature' && <SesLine />}
        </Split>
      )}
    </WizardSheet>
  )
}

const pickRow =
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.04] aria-pressed:bg-brand-solid/[0.08]'

function TemplatePicker({
  selected,
  onPick,
  onFromDocument,
}: {
  selected: Template | null
  onPick: (template: Template) => void
  onFromDocument?: () => void
}) {
  const list = useTemplates()
  const [term, setTerm] = useState('')
  const templates = pickableTemplates(list.data ?? [], term)
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium">{translate('template2')}</h3>
        {onFromDocument && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onFromDocument}>
            {translate('useAFileFromDocuments')}
          </Button>
        )}
      </div>
      {(list.data?.length ?? 0) > 5 && (
        <label
          data-field-surface
          className={cn(
            fieldSurface,
            'flex h-9 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground',
          )}
        >
          <Search className="size-4 shrink-0 stroke-[1.5]" />
          <input
            type="search"
            aria-label={translate('searchTemplates')}
            placeholder={translate('searchTemplates')}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-placeholder"
          />
        </label>
      )}
      <div
        aria-label={translate('templates')}
        className="grid max-h-64 overflow-y-auto rounded-xl border p-1"
      >
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-pressed={template.id === selected?.id}
            onClick={() => onPick(template)}
            className={pickRow}
          >
            <LayoutTemplate className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{template.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {template.signers.length > 0
                  ? translate('asksForSignatures')
                  : translate('noSignatures')}
                {template.last_used_at &&
                  translate('used', { value1: formatRelative(template.last_used_at) })}
              </span>
            </span>
            {template.id === selected?.id && <Check className="size-4 text-brand" />}
          </button>
        ))}
        {templates.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {list.isPending
              ? translate('loading')
              : term
                ? translate('noTemplateMatches')
                : translate('noTemplatesYetMakeOneInDocumentsTemplates')}
          </p>
        )}
      </div>
    </section>
  )
}

function ClientPicker({
  selected,
  onPick,
}: {
  selected: Client | null
  onPick: (client: Client) => void
}) {
  const [term, setTerm] = useState('')
  const search = useClientSearch(term)
  const clients = search.data?.data ?? []
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">{translate('client')}</h3>
      <label
        data-field-surface
        className={cn(
          fieldSurface,
          'flex h-9 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground',
        )}
      >
        <Search className="size-4 shrink-0 stroke-[1.5]" />
        <input
          type="search"
          aria-label={translate('searchClients')}
          placeholder={translate('searchClients')}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-placeholder"
        />
      </label>
      <div
        aria-label={translate('clients')}
        className="grid max-h-64 overflow-y-auto rounded-xl border p-1"
      >
        {selected && !clients.some((client) => client.id === selected.id) && (
          <ClientRow client={selected} selected onPick={() => {}} />
        )}
        {clients.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            selected={client.id === selected?.id}
            onPick={() => onPick(client)}
          />
        ))}
        {clients.length === 0 && !selected && (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {search.isPending ? translate('searching') : translate('noClientMatches')}
          </p>
        )}
      </div>
    </section>
  )
}

function ClientRow({
  client,
  selected,
  onPick,
}: {
  client: Client
  selected: boolean
  onPick: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick} className={pickRow}>
      <Building2 className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{client.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          <span className="font-code">#{client.number}</span>
          {client.city && ` · ${client.city}`}
          {client.email && ` · ${client.email}`}
        </span>
      </span>
      {selected && <Check className="size-4 text-brand" />}
    </button>
  )
}

/** Templates matching the search, the most recently used first, then by name. */
export function pickableTemplates(templates: Template[], term: string) {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return templates
    .filter((template) => {
      const text = `${template.name} ${template.description ?? ''}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .toSorted(
      (a, b) =>
        (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '') || a.name.localeCompare(b.name),
    )
}

/** A field filled from the quote: a small sparkle, its source in a tooltip. */
function FilledMark({
  source,
  quoteNumber,
}: {
  source: 'quote' | 'ai'
  quoteNumber: string | null
}) {
  const text = translate(source === 'ai' ? 'filledByAIFromQuote' : 'filledFromQuote', {
    number: quoteNumber ?? translate('draft'),
  })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-source={source}
          className="inline-flex items-center gap-0.5 text-caption text-brand"
        >
          <Sparkles aria-label={text} className="size-3" />
          {source === 'ai' && <span aria-hidden>AI</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

const NO_SOURCES: ContractDraft['sources'] = {}

/** One input per kind of client data the template uses, and one per question it asks. */
function ValueFields({
  template,
  values,
  sources = NO_SOURCES,
  quoteNumber = null,
  tried,
  onChange,
}: {
  template: Template
  values: Record<string, string>
  /** A contract's fields filled from its quote, by field id. */
  sources?: ContractDraft['sources']
  quoteNumber?: string | null
  tried: boolean
  onChange: (key: string, value: string) => void
}) {
  const entries = template.fields
    .filter((field) => isDataKind(field.kind))
    .filter(
      (field, index, all) =>
        all.findIndex((other) => valueKey(other) === valueKey(field)) === index,
    )
  if (entries.length === 0)
    return (
      <p className="text-[13px] text-muted-foreground">
        {translate('thisTemplateHasNoClientFieldsTheDocumentIs')}
      </p>
    )
  return (
    <div className="grid gap-4">
      {entries.map((field) => {
        const key = valueKey(field)
        const custom = field.kind === 'custom'
        const label = custom
          ? (field.label ?? translate('text'))
          : isDataKind(field.kind)
            ? DATA_LABELS[field.kind]
            : ''
        const value = values[key] ?? ''
        const source = sources[field.id]
        const id = `fill-${key.replace(/\W/g, '-')}`
        return (
          <FormField
            key={key}
            id={id}
            label={label}
            mark={
              custom && source ? (
                <FilledMark source={source} quoteNumber={quoteNumber} />
              ) : undefined
            }
            required={custom}
            error={custom && tried && !value.trim() ? translate('fillThisIn') : undefined}
            status={
              !custom && !value.trim() ? translate('theClientHasNoneTheBoxStaysEmpty') : undefined
            }
          >
            {field.kind === 'client.address' ? (
              <Textarea
                id={id}
                value={value}
                rows={2}
                onChange={(event) => onChange(key, event.target.value)}
              />
            ) : (
              <Input
                id={id}
                value={value}
                onChange={(event) => onChange(key, event.target.value)}
              />
            )}
          </FormField>
        )
      })}
    </div>
  )
}

function Choice({
  icon: Icon,
  label,
  text,
  selected,
  disabled,
  onPick,
}: {
  icon: LucideIcon
  label: string
  text: string
  selected: boolean
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-brand-solid/60 aria-pressed:bg-brand-solid/[0.06]',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-muted-foreground" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[12.5px] text-muted-foreground">{text}</span>
      </span>
      {selected && <Check className="mt-0.5 size-4 text-brand" />}
    </button>
  )
}

/** The person behind each signing role, filled from the client where the role says so. */
function RoleSigners({
  template,
  signers,
  onSigners,
  order,
  onOrder,
  tried,
}: {
  template: Template
  signers: DraftSigner[]
  onSigners: (signers: DraftSigner[]) => void
  order: SigningOrder
  onOrder: (order: SigningOrder) => void
  tried: boolean
}) {
  const check = checkSigners(signers)
  const set = (index: number, change: Partial<DraftSigner>) =>
    onSigners(signers.map((signer, i) => (i === index ? { ...signer, ...change } : signer)))
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">{translate('signers')}</h3>
      <ol className="grid gap-2">
        {template.signers.map((role, index) => {
          const signer = signers[index] ?? { name: '', email: '' }
          const row = check.rows[index]
          return (
            <li key={index} className="grid gap-2 rounded-xl border p-2.5">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: signerColor(index + ROLE_LANE) }}
                />
                {role.label}
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Input
                    aria-label={translate('name2', { label: role.label })}
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
                    aria-label={translate('email4', { label: role.label })}
                    placeholder={translate('nameCompanyCh')}
                    value={signer.email}
                    aria-invalid={tried && !!row?.email}
                    onChange={(event) => set(index, { email: event.target.value })}
                  />
                  {tried && row?.email && <p className="text-xs text-destructive">{row.email}</p>}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      {template.signers.length > 1 && (
        <div className={cn(segmentTrack, 'grid grid-cols-2')}>
          {(
            [
              ['parallel', 'Everyone at once'],
              ['sequential', 'One after another'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => onOrder(value)}
              className={cn(segmentItem, 'h-7')}
            >
              {segmentLabels(label)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
