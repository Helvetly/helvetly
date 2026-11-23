'use client'
// Templates, typed by hand from docs/templates-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, type ApiError } from '@/lib/api'
import { LANGUAGES, streetLine, type Client, type Language } from '@/lib/clients'
import { refreshDocuments } from '@/lib/documents'
import type { EmailLanguage } from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'
import {
  checkSigners,
  type Box,
  type DraftField,
  type DraftSigner,
  type FieldKind,
  type RequestStatus,
  type SigningOrder,
} from '@/lib/signatures'

/** A box stamped in when a document is made from the template: the client's data, or a custom field. */
export type DataKind =
  | 'client.name'
  | 'client.address'
  | 'client.email'
  | 'client.phone'
  | 'client.number'
  | 'client.vat_number'
  | 'contact.name'
  | 'today'
  | 'custom'

export const DATA_KINDS: readonly DataKind[] = [
  'client.name',
  'client.address',
  'client.email',
  'client.phone',
  'client.number',
  'client.vat_number',
  'contact.name',
  'today',
  'custom',
]

export const DATA_LABELS: Record<DataKind, string> = {
  'client.name': translate('clientName'),
  'client.address': translate('address'),
  'client.email': translate('email'),
  'client.phone': translate('phone'),
  'client.number': translate('clientNo'),
  'client.vat_number': translate('vatNumber'),
  'contact.name': translate('contactPerson'),
  today: translate('todaySDate'),
  custom: translate('askWhenFilling'),
}

export type TemplateKind = DataKind | FieldKind

export const isDataKind = (kind: string): kind is DataKind =>
  (DATA_KINDS as readonly string[]).includes(kind)

/** Who signs a document made from the template: the client's contact, or someone named on send. */
export type SignerRole = { label: string; fill: 'client' | 'manual' }

export type TemplateField = Box & {
  id: string
  kind: TemplateKind
  /** Index into the roles for a signing field; null for client data. */
  signer: number | null
  /** Text and custom fields: what to enter. */
  label: string | null
} & PrintSettings

/** How a client data field's value is printed: its size in points (none: 10), shrunk to fit with auto-fit. */
export type PrintSettings = {
  font_size?: number | null
  auto_fit?: boolean
  align?: TextAlign
}
export type TextAlign = 'left' | 'center' | 'right'
export const FONT_SIZES = { min: 8, max: 24, default: 10 } as const

export type Template = {
  id: string
  name: string
  description: string | null
  document: { id: string; name: string } | null
  signers: SignerRole[]
  fields: TemplateField[]
  used_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export type TemplateInput = {
  name: string
  description: string | null
  document_id: string
  signers: SignerRole[]
  fields: (Box & {
    kind: TemplateKind
    signer: number | null
    label: string | null
  } & PrintSettings)[]
}

export type Delivery =
  | { type: 'save' }
  | {
      type: 'email'
      /** One address or several, separated by commas. */
      to: string
      cc?: string[]
      bcc?: string[]
      subject?: string | null
      message: string | null
      language?: EmailLanguage
    }
  | {
      type: 'signature'
      signers: { name: string; email: string }[]
      message: string | null
      language?: EmailLanguage
      signing_order: SigningOrder
      expires_in_days: number
    }

export type GenerateRequest = {
  client_id: string
  /** The quote the document is a contract of: filed in the client's Documents/<year>/Contracts and linked to it. */
  quote_id?: string
  title: string
  /** Field id → the text stamped in it, for every client-data field. */
  values: Record<string, string>
  delivery: Delivery
}

export type Generated = {
  /** A quote's contract (quote_id given): its number. */
  contract_number?: string | null
  document: { id: string; name: string }
  signature_request_id: string | null
  emailed_to: string | null
}

// ---- the editor: lane 0 is the client's data, lane 1 custom fields, lane n + ROLE_LANE signing role n ----

export type TemplateDraftField = DraftField<TemplateKind> & PrintSettings

/** Fields that do not come from the client: the date, or a value asked for when filling. */
export const CUSTOM_KINDS: readonly DataKind[] = ['today', 'custom']
const CLIENT_KINDS = DATA_KINDS.filter((kind) => !CUSTOM_KINDS.includes(kind))

/** The lane of the first signing role. */
export const ROLE_LANE = 2

export const laneKinds = (lane: number): readonly TemplateKind[] =>
  lane === 0
    ? CLIENT_KINDS
    : lane === 1
      ? CUSTOM_KINDS
      : (['signature', 'date', 'name', 'text'] as const)

export const toDraftFields = (template: Template): TemplateDraftField[] =>
  template.fields.map(({ id, signer, ...field }) => ({
    ...field,
    key: id,
    signer:
      signer !== null
        ? signer + ROLE_LANE
        : (CUSTOM_KINDS as readonly string[]).includes(field.kind)
          ? 1
          : 0,
  }))

const asks = (kind: TemplateKind) => kind === 'text' || kind === 'custom'

export function buildTemplateBody(input: {
  name: string
  description: string
  documentId: string
  signers: SignerRole[]
  fields: TemplateDraftField[]
}): TemplateInput {
  return {
    name: input.name.trim(),
    description: input.description.trim() || null,
    document_id: input.documentId,
    signers: input.signers.map((role) => ({ ...role, label: role.label.trim() })),
    fields: input.fields.map(
      ({ kind, signer, page, x, y, w, h, label, font_size, auto_fit, align }) => ({
        kind,
        signer: signer < ROLE_LANE ? null : signer - ROLE_LANE,
        page,
        x,
        y,
        w,
        h,
        label: asks(kind) ? label?.trim() || null : null,
        // Only client data is printed by the template; signers fill the rest.
        ...(isDataKind(kind)
          ? { font_size: font_size ?? null, auto_fit: !!auto_fit, align: align ?? 'left' }
          : {}),
      }),
    ),
  }
}

/** What the editor's step needs before it lets you on (or saves), or null. */
export function templateProblem(
  step: number,
  state: {
    name: string
    document: { id: string } | null
    signers: SignerRole[]
    fields: TemplateDraftField[]
  },
): string | null {
  if (step === 0) {
    if (!state.document) return translate('chooseThePDFTheTemplateIsBuiltOn')
    if (!state.name.trim()) return translate('giveTheTemplateAName')
  }
  if (step === 1 && state.signers.some((role) => !role.label.trim()))
    return translate('nameEverySignerEGClientOrManagingDirector')
  if (step === 2) {
    if (state.fields.length === 0) return translate('placeAtLeastOneField')
    const unsigned = state.signers.filter(
      (_, index) =>
        !state.fields.some(
          (field) => field.signer === index + ROLE_LANE && field.kind === 'signature',
        ),
    )
    if (unsigned.length > 0)
      return translate('addASignatureFieldFor', {
        value1: unsigned.map((role) => role.label).join(', '),
      })
    if (state.fields.some((field) => asks(field.kind) && !field.label?.trim()))
      return translate('sayWhatToEnterInEachTextField')
  }
  return null
}

// ---- filling it for a client ----

export const primaryContact = (client: Client) =>
  client.contacts.find((contact) => contact.is_primary) ?? client.contacts[0] ?? null

const civil = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`

/** The client's value for a data kind, as it is stamped (empty when the client has none). */
export function dataValue(kind: DataKind, client: Client, today: Date): string {
  switch (kind) {
    case 'client.name':
      return client.name
    case 'client.address': {
      const city = [client.zip, client.city].filter(Boolean).join(' ')
      return [streetLine(client), city].filter(Boolean).join('\n')
    }
    case 'client.email':
      return client.email ?? ''
    case 'client.phone':
      return client.phone ?? ''
    case 'client.number':
      return String(client.number)
    case 'client.vat_number':
      return client.vat_number ?? ''
    case 'contact.name':
      return primaryContact(client)?.name ?? ''
    case 'today':
      return civil(today)
    case 'custom':
      return ''
  }
}

/**
 * What the person edits: one entry per data kind (the same value wherever it appears), one per
 * custom field (keyed by its id).
 */
export const valueKey = (field: { id: string; kind: TemplateKind }) =>
  field.kind === 'custom' ? field.id : field.kind

export function initialValues(template: Template, client: Client, today: Date) {
  const values: Record<string, string> = {}
  for (const field of template.fields)
    if (isDataKind(field.kind)) values[valueKey(field)] = dataValue(field.kind, client, today)
  return values
}

/** The per-field values the API takes. */
export const valuesByField = (template: Template, values: Record<string, string>) =>
  Object.fromEntries(
    template.fields
      .filter((field) => isDataKind(field.kind))
      .map((field) => [field.id, (values[valueKey(field)] ?? '').trim()]),
  )

/** Signers for a send: the client's role filled from its contact, the others left to type. */
export function defaultSigners(template: Template, client: Client): DraftSigner[] {
  const contact = primaryContact(client)
  return template.signers.map((role) =>
    role.fill === 'client'
      ? contact?.email
        ? { name: contact.name, email: contact.email }
        : { name: client.name, email: client.email ?? '' }
      : { name: '', email: '' },
  )
}

export type DeliveryType = Delivery['type']

/** What the fill step needs before it lets you on (or sends), or null. */
export function generateProblem(
  step: number,
  state: {
    template: Template | null
    client: Client | null
    title: string
    values: Record<string, string>
    delivery: DeliveryType
    emailTo: string
    signers: DraftSigner[]
  },
): string | null {
  if (step === 0) {
    if (!state.template) return translate('chooseATemplate')
    if (!state.client) return translate('chooseTheClient')
  }
  if (step === 1) {
    if (!state.title.trim()) return translate('giveTheDocumentATitle')
    const missing = (state.template?.fields ?? []).find(
      (field) => field.kind === 'custom' && !(state.values[field.id] ?? '').trim(),
    )
    if (missing)
      return translate('fillIn2', { value1: missing.label ?? translate('theCustomField') })
  }
  if (step === 2 && state.delivery === 'signature') {
    const check = checkSigners(state.signers)
    if (!check.ok) return check.list || translate('checkTheSignersNamesAndEmailAddresses')
  }
  // The message step: every address in To well formed, at least one.
  if (
    step === 3 &&
    state.delivery === 'email' &&
    !(
      state.emailTo.trim() &&
      state.emailTo
        .split(/[,;\s]+/)
        .filter(Boolean)
        .every((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    )
  )
    return translate('enterTheEmailAddressToSendItTo')
  return null
}

// ---- the API ----

const path = (id: string) => `/templates/${encodeURIComponent(id)}`

export const templatesApi = {
  list: () => request<{ data: Template[] }>('/templates'),
  get: (id: string) => request<{ data: Template }>(path(id)),
  create: (body: TemplateInput) =>
    request<{ data: Template }>('/templates', { method: 'POST', json: body }),
  update: (id: string, body: TemplateInput) =>
    request<{ data: Template }>(path(id), { method: 'PUT', json: body }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  generate: (id: string, body: GenerateRequest) =>
    request<{ data: Generated }>(`${path(id)}/documents`, { method: 'POST', json: body }),
  contractDraft: (quoteId: string, body: { template_id: string; use_ai: boolean }) =>
    request<{ data: ContractDraft }>(`/quotes/${encodeURIComponent(quoteId)}/contract-draft`, {
      method: 'POST',
      json: body,
    }),
  contractWrite: (quoteId: string, body: ContractWriteRequest) =>
    request<{ data: WrittenContract }>(`/quotes/${encodeURIComponent(quoteId)}/contract-drafts`, {
      method: 'POST',
      json: body,
    }),
  contractPreview: (quoteId: string, body: ContractSections) =>
    request<{ data: ContractPreview }>(`/quotes/${encodeURIComponent(quoteId)}/contract-preview`, {
      method: 'POST',
      json: body,
    }),
  createContract: (quoteId: string, body: ContractSections & { delivery: Delivery }) =>
    request<{ data: Generated }>(`/quotes/${encodeURIComponent(quoteId)}/contracts`, {
      method: 'POST',
      json: body,
    }),
  quoteContracts: (quoteId: string) =>
    request<{ data: QuoteContract[] }>(`/quotes/${encodeURIComponent(quoteId)}/contracts`),
  contractCounts: () => request<{ data: Record<string, number> }>('/quotes/contract-counts'),
}

/**
 * A contract's custom fields filled from a quote (`POST /quotes/{id}/contract-draft`): `sources` says
 * which were matched by name ("quote") and which the AI model wrote ("ai"); `ai` is how the model went.
 */
export type ContractDraft = {
  fields: Record<string, string>
  sources: Record<string, 'quote' | 'ai'>
  ai: 'used' | 'not_needed' | 'skipped' | 'unavailable' | 'quota_exceeded' | 'failed'
  quote: { id: string; number: string | null }
}

export type ContractClause = { heading: string; body: string }

/** A written contract's text as reviewed; the parties, the quote's tables and the signatures come from the data. */
export type ContractSections = {
  title: string
  language: Language
  intro: string
  clauses: ContractClause[]
}

/**
 * Something to check in the text: an amount or date the quote does not have, or contact data removed from the
 * AI's text. `clause` -1 is the title or introduction.
 */
export type ContractWarning = {
  clause: number
  kind: 'amount' | 'date' | 'personal_data'
  text: string
}

export type ContractWriteRequest = {
  mode: 'ai' | 'example' | 'improve'
  language: Language
  instructions: string
  example_document_id?: string
  clause?: ContractClause
}

export type WrittenContract = ContractSections & { warnings: ContractWarning[] }

/** The contract as it prints, numbered "Draft": a base64 PDF. */
export type ContractPreview = { pdf: string; pages: number; warnings: ContractWarning[] }

/** The language a contract for this client is written in: the client's, else the quote's, else German. */
const isLanguage = (value: string | null | undefined): value is Language =>
  LANGUAGES.some((language) => language === value)

export function contractLanguage(client: string | null | undefined, quote: string): Language {
  if (isLanguage(client)) return client
  return isLanguage(quote) ? quote : 'de'
}

/** What the review step needs before it lets you on, or null. */
export function sectionsProblem(sections: ContractSections): string | null {
  if (!sections.title.trim()) return translate('giveTheContractATitle')
  if (sections.clauses.length === 0) return translate('addAtLeastOneSection')
  if (sections.clauses.some((clause) => !clause.heading.trim() || !clause.body.trim()))
    return translate('everySectionNeedsAHeadingAndText')
  return null
}

/** A contract made from a quote, newest first, with its latest signature request. */
export type QuoteContract = {
  document_id: string
  /** Its own number, e.g. 2026/C/001; the file is named after it (2026-C-001.pdf). */
  number: string
  name: string
  created_at: string
  signature: { id: string; status: RequestStatus } | null
}

export const contractKeys = {
  all: [...queryKeys.documents, 'quote-contracts'] as const,
  of: (quoteId: string) => [...contractKeys.all, quoteId] as const,
  counts: () => [...contractKeys.all, 'counts'] as const,
}

/** The contracts made from a quote. */
export function useQuoteContracts(quoteId: string, enabled = true) {
  return useQuery({
    queryKey: contractKeys.of(quoteId),
    queryFn: async () => (await templatesApi.quoteContracts(quoteId)).data,
    enabled,
  })
}

/** How many contracts each quote has, for the list's mark; {} while loading or without access. */
export function useContractCounts(enabled = true) {
  return useQuery({
    queryKey: contractKeys.counts(),
    queryFn: async () => (await templatesApi.contractCounts()).data,
    enabled,
    staleTime: 30_000,
  })
}

// Under documents, so refreshDocuments (after any file write) refreshes these too.
export const templateKeys = {
  all: [...queryKeys.documents, 'templates'] as const,
}

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templateKeys.all,
    queryFn: async () => (await templatesApi.list()).data,
    enabled,
  })
}

/** A write on templates; the list refetches, and so do the documents it may have filed. */
export function useTemplateMutation<Input, Output>(fn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation<Output, ApiError, Input>({
    mutationFn: fn,
    onSuccess: () => refreshDocuments(queryClient),
  })
}

/** A saved template as the body that saves it again (renamed, or as a copy); null once its PDF is gone. */
export const templateInput = (template: Template, name = template.name): TemplateInput | null =>
  template.document && {
    name,
    description: template.description,
    document_id: template.document.id,
    signers: template.signers,
    fields: template.fields.map(({ id: _id, ...field }) => field),
  }
