'use client'
import { locale } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { segmentLabels } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { segmentItem, segmentTrack } from '@helvetly/ui/lib/segmented'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  FileDown,
  FileSignature,
  LayoutTemplate,
  Loader2,
  Mail,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useAIApproval } from '@/components/ai/ai-approval'
import {
  EmailComposer,
  EmailLanguageField,
  EmailPreviewPane,
  type Recipients,
} from '@/components/email-composer'
import { emails, recipientErrors } from '@/components/invoices/invoice-dialogs'
import { ContractSignDrawer } from '@/components/signatures/create-drawer'
import { SesLine } from '@/components/signatures/parts'
import { DocPreview } from '@/components/signatures/pdf-parts'
import { failed, Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { useAI } from '@/lib/ai'
import type { Client } from '@/lib/clients'
import {
  emailLanguage,
  useEmailPreview,
  useTemplateDraft,
  type EmailLanguage,
} from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import { checkSigners, signerColor, type DraftSigner, type SigningOrder } from '@/lib/signatures'
import {
  blockSigners,
  defaultSigners,
  generateProblem,
  initialValues,
  isDataKind,
  primaryContact,
  templatesApi,
  toDraftFields,
  useTemplateMutation,
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

import { Choice, ClientPicker, templateCaption, TemplatePicker, ValueFields } from './fill-parts'

const STEPS = [translate('templateClient'), translate('fillIn'), translate('send')] as const
/** With an email or a signature request, the email is written in a step of its own. */
const MESSAGE_STEPS = [...STEPS, translate('message')] as const

/**
 * A contract made from a quote: its client is the quote's, the template's own fields are filled from
 * the quote (by name, the rest by the AI model), and the document is numbered and linked to the quote.
 */
export type ContractSource = {
  quoteId: string
  quoteNumber: string | null
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
  const [recipients, setRecipients] = useState<Recipients>({ to: '', cc: '', bcc: '' })
  const [language, setLanguage] = useState<EmailLanguage>(
    emailLanguage(initialClient?.language, emailLanguage(locale)),
  )
  // Opened from a client: that client is the one, until "Change" asks for the picker.
  const [changingClient, setChangingClient] = useState(!initialClient)
  const [signers, setSigners] = useState<DraftSigner[]>([])
  const [order, setOrder] = useState<SigningOrder>('parallel')
  // A template without signing fields: everyone signs on a page added at the end, or the person places the fields
  // on the filed document with the signatures' own drawer (`placing`).
  const [placeMyself, setPlaceMyself] = useState(false)
  const [placing, setPlacing] = useState<string | null>(null)
  const [pages, setPages] = useState(0)
  const [tried, setTried] = useState(false)
  // A contract: where each field's value came from (quote or AI), and how the AI went.
  const [sources, setSources] = useState<ContractDraft['sources']>({})
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const { ensure } = useAIApproval()
  const ai = useAI()
  const generate = useTemplateMutation((input: { id: string; body: GenerateRequest }) =>
    templatesApi.generate(input.id, input.body),
  )

  const session = useSession().data
  const email = useTemplateDraft(
    delivery === 'signature' ? 'signature_request' : 'document',
    language,
    {
      document: title.trim(),
      client: client?.name ?? '',
      sender: session?.user.name || session?.user.email || '',
      company: session?.workspace.name ?? '',
    },
  )
  const message = email.message
  // Placing the fields yourself files the document first; the signatures' drawer then asks for the message.
  const sent: DeliveryType = delivery === 'signature' && placeMyself ? 'save' : delivery
  const steps = sent === 'save' ? STEPS : MESSAGE_STEPS
  const emailPreview = useEmailPreview(
    delivery === 'signature' ? '/signatures/email-preview' : '/templates/email-preview',
    delivery === 'signature'
      ? { title, message, language, expires_in_days: 30 }
      : { title, subject: email.subject, message, language },
    step === 3 && delivery !== 'save',
  )
  const state = { template, client, title, values, delivery, emailTo: recipients.to, signers }
  const addressErrors =
    step === 3 && delivery === 'email'
      ? recipientErrors(recipients.to, recipients.cc, recipients.bcc)
      : {}
  const problem =
    generateProblem(step, state) ??
    Object.values(addressErrors)[0] ??
    (step === 3 && delivery === 'email' && !email.subject.trim()
      ? translate('emailSubjectRequired')
      : null)
  const composerErrors = tried ? addressErrors : {}
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
    setPlaceMyself(false)
    setRecipients({
      to: primaryContact(forClient)?.email ?? forClient.email ?? '',
      cc: '',
      bcc: '',
    })
    setLanguage(emailLanguage(forClient.language, emailLanguage(locale)))
    const you = session ? { name: session.user.name, email: session.user.email } : null
    setSigners(
      chosen.signers.length > 0 ? defaultSigners(chosen, forClient) : blockSigners(forClient, you),
    )
  }
  // The quote's details for the template's fields; the model only with the person's approval.
  const contractDraft = async (templateId: string) => {
    if (!contract) return null
    setDrafting(true)
    try {
      // The model only on an installation with one, a pool not used up and the person's approval.
      const body = {
        template_id: templateId,
        use_ai: ai.available && !ai.usedUp && (await ensure()),
      }
      return (await templatesApi.contractDraft(contract.quoteId, body)).data
    } catch (error) {
      failed(translate('couldNotFillInTheTemplate'), error)
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
    const body: GenerateRequest = {
      client_id: client.id,
      ...(contract && { quote_id: contract.quoteId }),
      title: title.trim(),
      values: valuesByField(template, values),
      delivery:
        sent === 'email'
          ? {
              type: 'email',
              to: emails(recipients.to).join(', ').toLowerCase(),
              cc: emails(recipients.cc),
              bcc: emails(recipients.bcc),
              subject: email.subject.trim() || null,
              message: message.trim() || null,
              language,
            }
          : sent === 'signature'
            ? {
                type: 'signature',
                signers: signers.map((signer) => ({
                  name: signer.name.trim(),
                  email: signer.email.trim().toLowerCase(),
                })),
                message: message.trim() || null,
                language,
                signing_order: order,
                expires_in_days: 30,
              }
            : { type: 'save' },
    }
    generate.mutate(
      { id: template.id, body },
      {
        onSuccess: ({ data }) => {
          if (delivery === 'signature' && placeMyself) {
            toast.success(translate('savedToDocuments', { name: data.document.name }))
            return setPlacing(data.document.id)
          }
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
        onError: (error) => failed(translate('couldNotCreateTheDocument'), error),
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
      caption={templateCaption}
      printed={printed}
      pages={pages}
      onPages={setPages}
      empty={translate('chooseATemplateToSeeItHere')}
    />
  )
  const actionLabel =
    delivery === 'signature' && placeMyself
      ? translate('saveAndPlaceFields')
      : delivery === 'signature'
        ? translate('sendForSignature2')
        : delivery === 'email'
          ? translate('sendEmail')
          : translate('saveToDocuments')

  if (placing) return <ContractSignDrawer documentId={placing} onClose={onClose} />
  return (
    <WizardSheet
      icon={contract ? <Sparkles /> : <LayoutTemplate />}
      title={
        step > 0 && title.trim()
          ? title.trim()
          : contract
            ? ai.available
              ? translate('createContractWithAI')
              : translate('createContract')
            : translate('newDocumentFromATemplate')
      }
      steps={steps}
      step={step}
      onStep={setStep}
      dirty={dirty}
      busy={generate.isPending || drafting}
      discardTitle={translate('discardThisDocument')}
      onClose={onClose}
      status={[template?.name ?? 'No template chosen', client?.name].filter(Boolean).join(' · ')}
      error={tried ? problem : null}
      action={
        step < steps.length - 1 ? (
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
          <TemplatePicker selected={template} onPick={setTemplate} />
          {contract ? null : changingClient || !client ? (
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
                  : translate('everyoneSignsOnAPageAddedAtTheEnd')
              }
              selected={delivery === 'signature'}
              onPick={() => setDelivery('signature')}
            />
          </div>
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
          {delivery === 'signature' && template.signers.length === 0 && (
            <SwitchRow
              id="fill-place-fields"
              label={translate('placeFieldsMyself')}
              description={translate('placeFieldsMyselfText')}
              checked={placeMyself}
              onCheckedChange={setPlaceMyself}
            />
          )}
          {delivery === 'signature' && <SesLine />}
        </Split>
      )}
      {step === 3 && template && client && delivery !== 'save' && (
        <Split
          preview={
            <EmailPreviewPane preview={emailPreview.data} pending={emailPreview.isPending} />
          }
        >
          <StepTitle
            title={
              delivery === 'signature'
                ? translate('theEmailToTheSigners')
                : translate('theEmailToTheClient')
            }
            text={
              delivery === 'signature'
                ? translate('eachSignerGetsThisEmailWithTheirOwnLink')
                : translate('theDocumentGoesWithItAsAPDF')
            }
          />
          <EmailLanguageField id="fill-language" value={language} onChange={setLanguage} />
          <EmailComposer
            id="fill"
            {...(delivery === 'email'
              ? {
                  recipients,
                  onRecipients: setRecipients,
                  subject: email.subject,
                  onSubject: email.setSubject,
                  attachments: [`${title.trim()}.pdf`],
                }
              : {})}
            message={message}
            onMessage={email.setMessage}
            disabled={email.loading}
            errors={composerErrors}
            language={language}
            context={{ document: title, client: client.name }}
          />
          {delivery === 'signature' && <SesLine />}
        </Split>
      )}
    </WizardSheet>
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
  // Without signing fields the signers are free: anyone, up to 10, each signing on the page added at the end.
  const free = template.signers.length === 0
  const roles = free
    ? signers.map((_, index) => ({ label: translate('signer', { value1: index + 1 }) }))
    : template.signers
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">{translate('signers')}</h3>
      <ol className="grid gap-2">
        {roles.map((role, index) => {
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
                {free && signers.length > 1 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="ml-auto"
                        aria-label={translate('removeSigner', { value1: index + 1 })}
                        onClick={() => onSigners(signers.filter((_, i) => i !== index))}
                      >
                        <X />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {translate('removeSigner', { value1: index + 1 })}
                    </TooltipContent>
                  </Tooltip>
                )}
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
      {free && signers.length < 10 && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit gap-1.5"
          onClick={() => onSigners([...signers, { name: '', email: '' }])}
        >
          <Plus className="size-3.5" />
          {translate('addAnotherSigner')}
        </Button>
      )}
      {roles.length > 1 && (
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
