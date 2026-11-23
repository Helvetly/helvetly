'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Textarea } from '@helvetly/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import {
  FileDown,
  FileSignature,
  FileText,
  LayoutTemplate,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAIApproval } from '@/components/ai/ai-approval'
import { AIBudgetUsedUp } from '@/components/ai/ai-budget'
import { LANGUAGE_OPTIONS } from '@/components/clients/client-form-model'
import { NativeSelect } from '@/components/clients/fields'
import { PdfView } from '@/components/invoices/pdf-view'
import { SesLine } from '@/components/signatures/parts'
import { DocPreview, PdfPicker } from '@/components/signatures/pdf-parts'
import { Choice } from '@/components/templates/fill-parts'
import { failed, Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { useAI } from '@/lib/ai'
import { ApiError } from '@/lib/api'
import { type Client, type Language } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import type { Quote } from '@/lib/quotes'
import { checkSigners, type DraftSigner } from '@/lib/signatures'
import {
  contractLanguage,
  primaryContact,
  sectionsProblem,
  templatesApi,
  useTemplateMutation,
  type ContractClause,
  type ContractSections,
  type ContractWarning,
  type Delivery,
  type DeliveryType,
  type Generated,
} from '@/lib/templates'

export type ContractMode = 'ai' | 'example' | 'template'

const STEPS = [translate('contractWay'), translate('review'), translate('send')] as const

/** A warning as the review step says it. */
export function warningText(warning: ContractWarning) {
  if (warning.kind === 'amount')
    return translate('contractAmountNotInQuote', { text: warning.text })
  if (warning.kind === 'date') return translate('contractDateNotInQuote', { text: warning.text })
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

/**
 * "Create contract with AI" from a quote: written by the AI (alone or after an example contract), reviewed section
 * by section beside the printed preview, then numbered, filed in the client's Contracts folder and saved, emailed or
 * sent for signature. "Fill a template" hands over to the template drawer.
 */
export function ContractWriter({
  quote,
  client,
  onTemplate,
  onMade,
  onClose,
}: {
  quote: Quote
  client: Client
  /** "Fill a template" was chosen: the host opens the template drawer. */
  onTemplate: () => void
  onMade: (made: Generated) => void
  onClose: () => void
}) {
  const { ensure } = useAIApproval()
  // The host shows this only with AI on the installation; an empty pool leaves only the template.
  const ai = useAI()
  const session = useSession().data
  const [step, setStep] = useState(0)
  const [chosen, setChosen] = useState<ContractMode>('ai')
  const mode: ContractMode = ai.available ? chosen : 'template'
  const aiBlocked = mode !== 'template' && ai.usedUp
  const [language, setLanguage] = useState<Language>(() =>
    contractLanguage(client.language, quote.language),
  )
  const [instructions, setInstructions] = useState('')
  const [example, setExample] = useState<{ id: string; name: string } | null>(null)
  const [sections, setSections] = useState<Draft | null>(null)
  const [removed, setRemoved] = useState<ContractWarning[]>([])
  const [writing, setWriting] = useState(false)
  const [preview, setPreview] = useState<{ pdf: string; warnings: ContractWarning[] } | null>(null)
  const [pages, setPages] = useState(0)
  const [delivery, setDelivery] = useState<DeliveryType>('save')
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
  const create = useTemplateMutation(
    (body: ContractSections & { delivery: Delivery; document_id?: string }) =>
      templatesApi.createContract(quote.id, body),
  )
  const pdfUrl = usePdfUrl(preview?.pdf ?? null)

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
    step === 0
      ? aiBlocked
        ? translate('aiBudgetUsedUp')
        : mode === 'example' && !example
          ? translate('chooseAnExampleContract')
          : null
      : step === 1
        ? sections && sectionsProblem(sections)
        : sendProblem(delivery, emailTo, signers)

  const write = async () => {
    if (!(await ensure())) return false
    setWriting(true)
    try {
      const { data } = await templatesApi.contractWrite(quote.id, {
        mode: mode === 'example' ? 'example' : 'ai',
        language,
        instructions: instructions.trim(),
        ...(mode === 'example' && example && { example_document_id: example.id }),
      })
      setSections({
        title: data.title,
        language: data.language,
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

  const next = async () => {
    setTried(true)
    if (problem) return
    setTried(false)
    if (step === 0) {
      if (mode === 'template') return onTemplate()
      if (!sections && !(await write())) return
    }
    setStep(step + 1)
  }

  const send = () => {
    setTried(true)
    if (problem || !sections) return
    const body: Delivery =
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
              signing_order: 'sequential',
              expires_in_days: 30,
            }
          : { type: 'save' }
    create.mutate(
      { ...toSections(sections), delivery: body, ...(filed && { document_id: filed }) },
      {
        onSuccess: ({ data }) => {
          onMade(data)
          onClose()
        },
        onError: (error) => {
          const saved = error instanceof ApiError ? error.details.document_id : undefined
          if (typeof saved === 'string') setFiled(saved)
          failed(translate('couldNotCreateTheContract'), error)
        },
      },
    )
  }

  const warnings = [...removed, ...(preview?.warnings ?? [])]
  const printed = pdfUrl ? (
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
  const startPreview = (
    <DocPreview
      document={mode === 'example' ? example : null}
      fields={[]}
      caption={() => null}
      pages={pages}
      onPages={setPages}
      empty={translate('theContractIsPrintedHere')}
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
      icon={<Sparkles />}
      title={
        step > 0 && sections?.title.trim() ? sections.title : translate('createContractWithAI')
      }
      steps={STEPS}
      step={step}
      onStep={(to) => (to === 0 || sections ? setStep(to) : undefined)}
      dirty={sections !== null}
      busy={writing || create.isPending}
      discardTitle={translate('discardThisDocument')}
      onClose={onClose}
      status={[quote.number ?? translate('draft'), client.name].join(' · ')}
      error={tried ? problem : null}
      action={
        step < STEPS.length - 1 ? (
          <Button
            className="cursor-pointer gap-1.5"
            disabled={writing || (step === 0 && aiBlocked)}
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
      {step === 0 && (
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
              onPick={() => setChosen('ai')}
            />
            <Choice
              icon={FileText}
              label={translate('basedOnAnExampleDocument')}
              text={translate('basedOnAnExampleText')}
              selected={mode === 'example'}
              onPick={() => setChosen('example')}
            />
            <Choice
              icon={LayoutTemplate}
              label={translate('fillATemplate')}
              text={translate('fillATemplateText')}
              selected={mode === 'template'}
              onPick={() => setChosen('template')}
            />
          </div>
          {aiBlocked && (
            <Callout tone="warning" title={translate('aiBudgetUsedUpTitle')}>
              <AIBudgetUsedUp />
            </Callout>
          )}
          {mode === 'example' && !aiBlocked && (
            <PdfPicker
              document={example}
              folderId={null}
              onChoose={(file) => {
                setExample(file)
                setSections(null)
              }}
            />
          )}
          {mode !== 'template' && !aiBlocked && (
            <>
              <FormField
                id="contract-language"
                label={translate('contractLanguage')}
                tip={translate('contractLanguageTip')}
              >
                <NativeSelect
                  id="contract-language"
                  value={language}
                  onChange={(event) => {
                    const picked = LANGUAGE_OPTIONS.find((o) => o.code === event.target.value)
                    if (picked) setLanguage(picked.code)
                    setSections(null)
                  }}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="contract-instructions" label={translate('instructionsForTheAI')}>
                <Textarea
                  id="contract-instructions"
                  value={instructions}
                  maxLength={2000}
                  rows={3}
                  placeholder={translate('instructionsForTheAIPlaceholder')}
                  onChange={(event) => {
                    setInstructions(event.target.value)
                    setSections(null)
                  }}
                />
              </FormField>
            </>
          )}
        </Split>
      )}
      {step === 1 && sections && (
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
        </Split>
      )}
      {step === 2 && sections && (
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
              text={translate('youAndTheClientSignInTheSignatureBlock')}
              selected={delivery === 'signature'}
              onPick={() => setDelivery('signature')}
            />
          </div>
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
          {delivery === 'signature' &&
            signers.map((signer, index) => (
              <fieldset key={index === 0 ? 'contractor' : 'client'} className="grid gap-2">
                <legend className="mb-1 text-body-sm font-medium">
                  {index === 0 ? translate('youAsTheContractor') : translate('client')}
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={`${translate('name')} ${index + 1}`}
                    placeholder={translate('name')}
                    value={signer.name}
                    onChange={(event) =>
                      setSigners(
                        signers.map((old, at) =>
                          at === index ? { ...old, name: event.target.value } : old,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`${translate('email')} ${index + 1}`}
                    placeholder={translate('email')}
                    type="email"
                    value={signer.email}
                    onChange={(event) =>
                      setSigners(
                        signers.map((old, at) =>
                          at === index ? { ...old, email: event.target.value } : old,
                        ),
                      )
                    }
                  />
                </div>
              </fieldset>
            ))}
          {delivery !== 'save' && (
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
