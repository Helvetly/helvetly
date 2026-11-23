'use client'
import { locale } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import {
  FileDown,
  FileSignature,
  FileText,
  LayoutTemplate,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
  Trash2,
} from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'

import { ContractSignatureEditor } from '@/components/account/contract-signature'
import { useAIApproval } from '@/components/ai/ai-approval'
import { AIBudgetUsedUp } from '@/components/ai/ai-budget'
import { NativeSelect } from '@/components/clients/fields'
import { PdfView } from '@/components/invoices/pdf-view'
import { SesLine } from '@/components/signatures/parts'
import { DocPreview, PdfPicker } from '@/components/signatures/pdf-parts'
import { Choice, TemplatePicker } from '@/components/templates/fill-drawer'
import { failed, Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { useAI } from '@/lib/ai'
import { ApiError } from '@/lib/api'
import { type Client } from '@/lib/clients'
import { signatureImageUrl, useContractSignature } from '@/lib/contract-signature'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import type { Quote } from '@/lib/quotes'
import { checkSigners, type DraftSigner } from '@/lib/signatures'
import {
  contractLanguage,
  primaryContact,
  sectionsProblem,
  templatesApi,
  useContractLaw,
  useTemplateMutation,
  type ContractClause,
  type ContractCreateRequest,
  type ContractDelivery,
  type ContractSections,
  type ContractWarning,
  type DeliveryType,
  type Generated,
  type GoverningLaw,
  type Template,
} from '@/lib/templates'

export type ContractMode = 'ai' | 'example' | 'template'
type Stage = 'way' | 'instructions' | 'review' | 'send'

const STAGE_LABELS: Record<Stage, string> = {
  way: translate('contractWay'),
  instructions: translate('instructions'),
  review: translate('review'),
  send: translate('send'),
}

/** The steps a way takes: a template hands over after the first, an example used as it is skips the review. */
export function stagesFor(mode: ContractMode, asIs: boolean): Stage[] {
  if (mode === 'template') return ['way']
  return asIs ? ['way', 'instructions', 'send'] : ['way', 'instructions', 'review', 'send']
}

/** A warning as the review step says it. */
export function warningText(warning: ContractWarning) {
  if (warning.kind === 'amount')
    return translate('contractAmountNotInQuote', { text: warning.text })
  if (warning.kind === 'date') return translate('contractDateNotInQuote', { text: warning.text })
  if (warning.kind === 'statute')
    return translate('contractStatuteNotInRules', { text: warning.text })
  return translate('contractPersonalDataRemoved', { text: warning.text })
}

/** What the send step needs before it lets you on, or null. */
export function sendProblem(delivery: DeliveryType, emailTo: string, signers: DraftSigner[]) {
  if (delivery === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo.trim()))
    return translate('enterAValidEmailAddress')
  if (delivery === 'signature') {
    const checked = checkSigners(signers)
    return (
      checked.list || checked.rows.flatMap((row) => [row.name, row.email]).find(Boolean) || null
    )
  }
  return null
}

/** Today, for the date printed beside your signature. */
const today = () => new Date().toISOString()

/** The base64 PDF as a URL the viewer can load; revoked when it changes. */
function usePdfUrl(base64: string | null) {
  const url = useMemo(() => {
    if (!base64) return null
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  }, [base64])
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])
  return url
}

/** A section as edited: its key keeps the row while headings and texts change. */
type Keyed = ContractClause & { key: string }
type Draft = Omit<ContractSections, 'clauses'> & { clauses: Keyed[] }

let nextKey = 0
const keyed = (clause: ContractClause): Keyed => ({ ...clause, key: `section-${nextKey++}` })

/** The draft as the API takes it. */
export function toSections(draft: Draft): ContractSections {
  return { ...draft, clauses: draft.clauses.map(({ heading, body }) => ({ heading, body })) }
}

/** The governing laws to choose from: Switzerland and the EU member states first, then the US states. */
function LawSelect({
  options,
  value,
  onChange,
}: {
  options: GoverningLaw[]
  value: string
  onChange: (code: string) => void
}) {
  const europe = options.filter((law) => law.family !== 'US')
  const us = options.filter((law) => law.family === 'US')
  return (
    <NativeSelect
      id="contract-law"
      value={value}
      disabled={options.length === 0}
      onChange={(event) => onChange(event.target.value)}
    >
      {europe.map((law) => (
        <option key={law.code} value={law.code}>
          {law.name}
        </option>
      ))}
      {us.length > 0 && (
        <optgroup label={translate('unitedStates')}>
          {us.map((law) => (
            <option key={law.code} value={law.code}>
              {law.name}
            </option>
          ))}
        </optgroup>
      )}
    </NativeSelect>
  )
}

/**
 * "Create contract" from a quote, three ways: written by the AI, based on an example document (adapted by the AI,
 * or used as it is), or a template filled from the quote. The AI's text is reviewed section by section beside the
 * printed preview; then the numbered contract is filed in the client's Contracts folder and saved, emailed or sent
 * for signature, your stored signature on the contractor's side.
 */
export function ContractWriter({
  quote,
  client,
  onTemplate,
  onMade,
  onPlace,
  onClose,
}: {
  quote: Quote
  client: Client
  /** A template was chosen: the host fills it from the quote. */
  onTemplate: (template: Template) => void
  onMade: (made: Generated) => void
  /** "Place fields myself": the contract is filed, the host opens the signatures' drawer on it. */
  onPlace: (made: Generated) => void
  onClose: () => void
}) {
  const { ensure } = useAIApproval()
  // The host shows this only with AI on the installation; an empty pool leaves the template or the example as is.
  const ai = useAI()
  const session = useSession().data
  const law = useContractLaw(quote.id).data
  const signature = useContractSignature().data
  const [mode, setMode] = useState<ContractMode>('ai')
  const [template, setTemplate] = useState<Template | null>(null)
  const [example, setExample] = useState<{ id: string; name: string } | null>(null)
  const [chosenAsIs, setAsIs] = useState(false)
  const asIs = mode === 'example' && (chosenAsIs || ai.usedUp)
  const stages = stagesFor(mode, asIs)
  const [stage, setStage] = useState<Stage>('way')
  const step = Math.max(0, stages.indexOf(stage))
  const aiBlocked = mode === 'ai' && ai.usedUp
  const [lawCode, setLawCode] = useState<string | null>(null)
  const governingLaw = lawCode ?? law?.default.code ?? ''
  const [instructions, setInstructions] = useState('')
  const [sections, setSections] = useState<Draft | null>(null)
  const [removed, setRemoved] = useState<ContractWarning[]>([])
  const [writing, setWriting] = useState(false)
  const [preview, setPreview] = useState<{ pdf: string; warnings: ContractWarning[] } | null>(null)
  const [pages, setPages] = useState(0)
  const [delivery, setDelivery] = useState<DeliveryType>('save')
  const [placeMyself, setPlaceMyself] = useState(false)
  const [unsigned, setUnsigned] = useState(false)
  const contact = primaryContact(client)
  const [emailTo, setEmailTo] = useState(contact?.email ?? client.email ?? '')
  const [signers, setSigners] = useState<DraftSigner[]>([
    { name: session?.user.name ?? '', email: session?.user.email ?? '' },
    { name: contact?.name ?? client.name, email: contact?.email ?? client.email ?? '' },
  ])
  const [message, setMessage] = useState('')
  const [tried, setTried] = useState(false)
  // The contract an attempt filed before its delivery failed: the retry sends that one, under its number.
  const [filed, setFiled] = useState<string | null>(null)
  const create = useTemplateMutation((body: ContractCreateRequest) =>
    templatesApi.createContract(quote.id, body),
  )
  const pdfUrl = usePdfUrl(preview?.pdf ?? null)
  // An example as it is has no signature block: its fields are placed by hand, never printed on it.
  const signs = !asIs && !!signature?.has_image && !unsigned
  const placing = delivery === 'signature' && (asIs || placeMyself)
  const signingWith = signs ? signers.slice(1) : signers

  // The printed contract follows the edits, a moment after the last one.
  useEffect(() => {
    if (!sections || sectionsProblem(sections)) return
    let current = true
    const timer = setTimeout(() => {
      templatesApi.contractPreview(quote.id, toSections(sections)).then(
        ({ data }) => current && setPreview({ pdf: data.pdf, warnings: data.warnings }),
        (error: unknown) => current && failed(translate('couldNotPreviewTheContract'), error),
      )
    }, 600)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [quote.id, sections])

  const problem =
    stage === 'way'
      ? aiBlocked
        ? translate('aiBudgetUsedUp')
        : mode === 'example' && !example
          ? translate('chooseAnExampleContract')
          : mode === 'template' && !template
            ? translate('chooseATemplate')
            : null
      : stage === 'review'
        ? sections && sectionsProblem(sections)
        : stage === 'send'
          ? sendProblem(delivery, emailTo, placing ? [] : signingWith)
          : null

  const write = async () => {
    if (!(await ensure())) return false
    setWriting(true)
    try {
      const { data } = await templatesApi.contractWrite(quote.id, {
        mode: mode === 'example' ? 'example' : 'ai',
        language: contractLanguage(locale),
        governing_law: governingLaw,
        instructions: instructions.trim(),
        ...(mode === 'example' && example && { example_document_id: example.id }),
      })
      setSections({
        title: data.title,
        language: data.language,
        governing_law: data.governing_law || governingLaw,
        intro: data.intro,
        clauses: data.clauses.map(keyed),
      })
      setRemoved(data.warnings.filter((warning) => warning.kind === 'personal_data'))
      return true
    } catch (error) {
      failed(translate('couldNotWriteTheContract'), error)
      return false
    } finally {
      setWriting(false)
    }
  }

  const setClause = (index: number, clause: Keyed) =>
    setSections(
      (current) =>
        current && {
          ...current,
          clauses: current.clauses.map((old, at) => (at === index ? clause : old)),
        },
    )

  // Anything the text is written from changed: the next "Next" writes it again.
  const restart = () => setSections(null)

  const next = async () => {
    setTried(true)
    if (problem) return
    setTried(false)
    if (stage === 'way' && mode === 'template' && template) return onTemplate(template)
    if (stage === 'instructions' && !asIs && !sections && !(await write())) return
    setStage(stages[step + 1] ?? stage)
  }

  const send = () => {
    setTried(true)
    if (problem || (!asIs && !sections)) return
    const body: ContractDelivery =
      placing || delivery === 'save'
        ? { type: 'save', signed: signs }
        : delivery === 'email'
          ? {
              type: 'email',
              to: emailTo.trim().toLowerCase(),
              message: message.trim() || null,
              signed: signs,
            }
          : {
              type: 'signature',
              signers: signingWith.map((signer) => ({
                name: signer.name.trim(),
                email: signer.email.trim().toLowerCase(),
              })),
              message: message.trim() || null,
              signing_order: 'sequential',
              expires_in_days: 30,
              signed: signs,
            }
    const request: ContractCreateRequest = {
      ...(asIs && example
        ? {
            as_is: true,
            example_document_id: example.id,
            title: example.name.replace(/\.pdf$/i, ''),
            language: contractLanguage(locale),
            governing_law: governingLaw,
          }
        : toSections(sections as Draft)),
      delivery: body,
      ...(filed && { document_id: filed }),
    }
    create.mutate(request, {
      onSuccess: ({ data }) => {
        if (placing) return onPlace(data)
        onMade(data)
        onClose()
      },
      onError: (error) => {
        const saved = error instanceof ApiError ? error.details.document_id : undefined
        if (typeof saved === 'string') setFiled(saved)
        failed(translate('couldNotCreateTheContract'), error)
      },
    })
  }

  const warnings = [...removed, ...(preview?.warnings ?? [])]
  const exampleView = (
    <DocPreview
      document={mode === 'example' ? example : null}
      fields={[]}
      caption={() => null}
      pages={pages}
      onPages={setPages}
      empty={translate('theContractIsPrintedHere')}
    />
  )
  const printed = asIs ? (
    exampleView
  ) : pdfUrl ? (
    <PdfView
      key={pdfUrl}
      src={pdfUrl}
      title={sections?.title ?? ''}
      className="absolute inset-0"
      onPages={setPages}
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center text-body-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" />
      {translate('preparingThePreview')}
    </div>
  )
  const startPreview =
    mode === 'template' ? (
      <DocPreview
        document={template?.document ?? null}
        fields={[]}
        caption={() => null}
        pages={pages}
        onPages={setPages}
        empty={translate('chooseATemplateToSeeItHere')}
      />
    ) : (
      exampleView
    )
  const actionLabel = placing
    ? translate('saveAndPlaceFields')
    : delivery === 'signature'
      ? translate('sendForSignature2')
      : delivery === 'email'
        ? translate('sendEmail')
        : translate('saveToDocuments')
  const signerField = (index: number, legend: string) => {
    const signer = signers[index]
    if (!signer) return null
    const set = (patch: Partial<DraftSigner>) =>
      setSigners(signers.map((old, at) => (at === index ? { ...old, ...patch } : old)))
    return (
      <fieldset key={index === 0 ? 'contractor' : 'client'} className="grid gap-2">
        <legend className="mb-1 text-body-sm font-medium">{legend}</legend>
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label={`${translate('name')} ${index + 1}`}
            placeholder={translate('name')}
            value={signer.name}
            onChange={(event) => set({ name: event.target.value })}
          />
          <Input
            aria-label={`${translate('email')} ${index + 1}`}
            placeholder={translate('email')}
            type="email"
            value={signer.email}
            onChange={(event) => set({ email: event.target.value })}
          />
        </div>
      </fieldset>
    )
  }

  return (
    <WizardSheet
      icon={ai.available ? <Sparkles /> : <ScrollText />}
      title={
        stage !== 'way' && sections?.title.trim() ? sections.title : translate('createContract')
      }
      steps={stages.map((at) => STAGE_LABELS[at])}
      step={step}
      onStep={(to) => {
        const target = stages[to]
        if (target && (to <= step || target !== 'review' || sections)) setStage(target)
      }}
      dirty={sections !== null}
      busy={writing || create.isPending}
      discardTitle={translate('discardThisDocument')}
      onClose={onClose}
      status={[quote.number ?? translate('draft'), client.name].join(' · ')}
      error={tried ? problem : null}
      action={
        stage !== 'send' ? (
          <Button
            className="cursor-pointer gap-1.5"
            disabled={writing || (stage === 'way' && aiBlocked)}
            onClick={() => void next()}
          >
            {writing && <Loader2 className="size-4 animate-spin" />}
            {writing ? translate('writingTheContract') : translate('next2')}
          </Button>
        ) : (
          <Button className="cursor-pointer gap-1.5" disabled={create.isPending} onClick={send}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            {actionLabel}
          </Button>
        )
      }
    >
      {stage === 'way' && (
        <Split preview={startPreview}>
          <StepTitle
            title={translate('howShouldTheContractBeWritten')}
            text={translate('contractFromQuoteText', {
              number: quote.number ?? translate('draft'),
            })}
          />
          <div className="grid gap-2">
            <Choice
              icon={Sparkles}
              label={translate('writeItWithAI')}
              text={translate('writeItWithAIText')}
              badge={translate('recommended')}
              selected={mode === 'ai'}
              onPick={() => setMode('ai')}
            />
            <Choice
              icon={FileText}
              label={translate('basedOnAnExampleDocument')}
              text={translate('basedOnAnExampleText')}
              selected={mode === 'example'}
              onPick={() => setMode('example')}
            />
            {mode === 'example' && (
              <PdfPicker
                document={example}
                folderId={null}
                onChoose={(file) => {
                  setExample(file)
                  restart()
                }}
              />
            )}
            <Choice
              icon={LayoutTemplate}
              label={translate('fillATemplate')}
              text={translate('fillATemplateText')}
              selected={mode === 'template'}
              onPick={() => setMode('template')}
            />
            {mode === 'template' && <TemplatePicker selected={template} onPick={setTemplate} />}
          </div>
          {aiBlocked && (
            <Callout tone="warning" title={translate('aiBudgetUsedUpTitle')}>
              <AIBudgetUsedUp />
            </Callout>
          )}
        </Split>
      )}
      {stage === 'instructions' && (
        <Split preview={startPreview}>
          <StepTitle
            title={translate('instructionsForTheContract')}
            text={
              mode === 'example'
                ? translate('instructionsForTheExampleText')
                : translate('instructionsForTheContractText')
            }
          />
          {mode === 'example' && (
            <div className="grid gap-2">
              <Choice
                icon={Sparkles}
                label={translate('adaptItWithAI')}
                text={translate('adaptItWithAIText')}
                selected={!asIs}
                disabled={ai.usedUp}
                onPick={() => setAsIs(false)}
              />
              <Choice
                icon={FileText}
                label={translate('skipAIUseItAsItIs')}
                text={translate('skipAIUseItAsItIsText')}
                selected={asIs}
                onPick={() => setAsIs(true)}
              />
            </div>
          )}
          {!asIs && (
            <>
              <FormField
                id="contract-instructions"
                label={translate('instructionsForTheAI')}
                tip={translate('instructionsLanguageTip')}
              >
                <Textarea
                  id="contract-instructions"
                  value={instructions}
                  maxLength={2000}
                  rows={4}
                  placeholder={translate('instructionsForTheAIPlaceholder')}
                  onChange={(event) => {
                    setInstructions(event.target.value)
                    restart()
                  }}
                />
              </FormField>
              <FormField
                id="contract-law"
                label={translate('governingLaw')}
                tip={translate('governingLawTip')}
              >
                <LawSelect
                  options={law?.options ?? []}
                  value={governingLaw}
                  onChange={(code) => {
                    setLawCode(code)
                    restart()
                  }}
                />
              </FormField>
              {law && (
                <p className="text-body-sm text-muted-foreground">
                  {law.b2c ? translate('consumerContractNote') : translate('businessContractNote')}
                </p>
              )}
            </>
          )}
        </Split>
      )}
      {stage === 'review' && sections && (
        <Split preview={printed}>
          <div className="flex items-start justify-between gap-3">
            <StepTitle
              title={translate('reviewTheContract')}
              text={translate('reviewTheContractText')}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={writing}
                  onClick={() => void write()}
                >
                  {writing ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  {translate('regenerate')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('regenerateTip')}</TooltipContent>
            </Tooltip>
          </div>
          {warnings.length > 0 && (
            <Callout tone="warning" title={translate('checkTheseDetails')}>
              <ul className="grid gap-0.5">
                {warnings.map((warning) => (
                  <li key={`${warning.kind}:${warning.clause}:${warning.text}`}>
                    {warning.clause >= 0 &&
                      `${translate('sectionN', { number: warning.clause + 1 })}: `}
                    {warningText(warning)}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          <FormField id="contract-title" label={translate('title')} required>
            <Input
              id="contract-title"
              value={sections.title}
              maxLength={200}
              onChange={(event) => setSections({ ...sections, title: event.target.value })}
            />
          </FormField>
          <FormField id="contract-intro" label={translate('introduction')}>
            <Textarea
              id="contract-intro"
              value={sections.intro}
              rows={2}
              maxLength={4000}
              onChange={(event) => setSections({ ...sections, intro: event.target.value })}
            />
          </FormField>
          <ol className="grid gap-4">
            {sections.clauses.map((clause, index) => (
              <li
                key={clause.key}
                aria-label={translate('sectionN', { number: index + 1 })}
                className="grid gap-2 rounded-xl border p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-body-sm text-muted-foreground tabular-nums">
                    {index + 1}.
                  </span>
                  <Input
                    aria-label={translate('sectionHeading', { number: index + 1 })}
                    value={clause.heading}
                    maxLength={200}
                    onChange={(event) =>
                      setClause(index, { ...clause, heading: event.target.value })
                    }
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={translate('removeSection')}
                        onClick={() =>
                          setSections({
                            ...sections,
                            clauses: sections.clauses.filter((_, at) => at !== index),
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{translate('removeSection')}</TooltipContent>
                  </Tooltip>
                </div>
                <Textarea
                  aria-label={translate('sectionText', { number: index + 1 })}
                  value={clause.body}
                  rows={4}
                  maxLength={8000}
                  onChange={(event) => setClause(index, { ...clause, body: event.target.value })}
                />
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-1.5"
            disabled={sections.clauses.length >= 40}
            onClick={() =>
              setSections({
                ...sections,
                clauses: [...sections.clauses, keyed({ heading: '', body: '' })],
              })
            }
          >
            <Plus className="size-3.5" />
            {translate('addSection')}
          </Button>
          <p className="text-caption text-muted-foreground">{translate('notLegalAdviceNote')}</p>
        </Split>
      )}
      {stage === 'send' && (
        <Split preview={printed}>
          <StepTitle
            title={translate('whatShouldHappenWithIt')}
            text={translate('theContractIsNumberedAndFiled')}
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
                asIs
                  ? translate('youPlaceTheSignatureFieldsYourself')
                  : signs
                    ? translate('theClientDatesAndSignsInItsColumn')
                    : translate('youAndTheClientSignInTheSignatureBlock')
              }
              selected={delivery === 'signature'}
              onPick={() => setDelivery('signature')}
            />
          </div>
          {!asIs && signature && (
            <ContractorSignature
              hasImage={signature.has_image}
              place={signature.place || signature.default_place}
              unsigned={unsigned}
              onUnsigned={setUnsigned}
              name={session?.user.name || session?.user.email || ''}
            />
          )}
          {delivery === 'email' && (
            <FormField id="contract-to" label={translate('to3')} required>
              <Input
                id="contract-to"
                type="email"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
              />
            </FormField>
          )}
          {delivery === 'signature' && !asIs && (
            <SwitchRow
              id="contract-place-fields"
              label={translate('placeFieldsMyself')}
              description={translate('placeFieldsMyselfText')}
              checked={placeMyself}
              onCheckedChange={setPlaceMyself}
            />
          )}
          {delivery === 'signature' &&
            !placing &&
            (signs
              ? signerField(1, translate('client'))
              : [
                  signerField(0, translate('youAsTheContractor')),
                  signerField(1, translate('client')),
                ])}
          {delivery !== 'save' && !placing && (
            <FormField id="contract-message" label={translate('message')}>
              <Textarea
                id="contract-message"
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

/**
 * Your side of the signature block: your stored signature with place and today's date, or (without one) the way to
 * add it here or go on unsigned.
 */
function ContractorSignature({
  hasImage,
  place,
  unsigned,
  onUnsigned,
  name,
}: {
  hasImage: boolean
  place: string
  unsigned: boolean
  onUnsigned: (unsigned: boolean) => void
  name: string
}) {
  if (hasImage)
    return (
      <div className="grid gap-2 rounded-xl border p-3">
        <SwitchRow
          id="contract-sign"
          label={translate('signItAsTheContractor')}
          description={translate('signedOnYourSide', {
            place: place || '—',
            date: formatDate(today()),
          })}
          checked={!unsigned}
          onCheckedChange={(checked) => onUnsigned(!checked)}
        />
        {!unsigned && (
          // served uncached, so it is the image stored now, also one added in this drawer
          <span className="relative block h-12 w-60">
            <Image
              src={signatureImageUrl(0)}
              alt={translate('yourSignature')}
              fill
              unoptimized
              sizes="240px"
              className="object-contain object-left"
            />
          </span>
        )}
      </div>
    )
  if (unsigned)
    return (
      <p className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
        {translate('unsignedOnYourSide')}
        <button
          type="button"
          className="cursor-pointer rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => onUnsigned(false)}
        >
          {translate('addYourSignature')}
        </button>
      </p>
    )
  return (
    <Callout tone="info" title={translate('addYourSignature')}>
      <div className="grid gap-3">
        <p>{translate('addYourSignatureText')}</p>
        <ContractSignatureEditor name={name} id="contract-writer-signature" />
        <Button variant="outline" size="sm" className="w-fit" onClick={() => onUnsigned(true)}>
          {translate('continueUnsigned')}
        </Button>
      </div>
    </Callout>
  )
}
