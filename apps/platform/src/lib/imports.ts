'use client'

// AI-assisted import, typed by hand from docs/imports-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, request } from '@/lib/api'
import { MAX_FILE_BYTES } from '@/lib/upload-packs'

export type ImportFile = {
  id: string
  name: string
  size: number
  status: 'queued' | 'extracting' | 'done' | 'failed'
  error: string | null
  chunks_done: number
  chunks_total: number | null
  reused: boolean
  /** What the AI recognised the file as, in an import that works it out (`auto`). */
  document_type: DocumentType | null
}

/** The document types an `auto` import tells apart. */
export const DOCUMENT_TYPES = {
  sales_invoice: 'Invoice you issued',
  bill: 'Bill you received',
  contract: 'Contract',
  client_list: 'Client list',
  product_list: 'Price list',
  other: 'Not recognised',
} as const

export type DocumentType = keyof typeof DOCUMENT_TYPES

/** One line of an imported invoice, as the model read it. */
export type ImportLine = Record<string, string | number | boolean>

export type ImportValue = string | number | boolean | ImportLine[]

export type ImportRecord = {
  id: string
  file_id: string
  /** The record's own kind: the batch's, or the one the AI chose in an `auto` import. */
  kind: ImportKind
  /** skipped: the person left it out (a number conflict they did not overwrite). */
  status: 'pending' | 'created' | 'failed' | 'skipped'
  data: Record<string, ImportValue>
  issues: Record<string, string>
  duplicate: { id: string; label: string; reason: string } | null
  entity_id: string | null
  error: string | null
}

/** What a batch imports: one kind, or `auto`, where the AI works out what each file is. */
export type ImportTarget = ImportKind | 'auto'

export type ImportBatch = {
  id: string
  kind: ImportTarget
  status: 'extracting' | 'review'
  created_at: string
  files: ImportFile[]
  records: ImportRecord[]
}

export type ImportSummary = {
  id: string
  kind: ImportTarget
  status: 'extracting' | 'review'
  created_at: string
  pending: number
}

/** An existing record an imported one collides with (an invoice number already used). */
export type ImportConflict = {
  id: string
  label: string
  reason: string
  can_overwrite: boolean
  /** Why it cannot be overwritten, for the person. */
  why_not: string | null
}

export type Resolution = 'overwrite' | 'skip'

export type CommitResult = {
  id: string
  /** conflict: nothing was created; the person resolves it with a second commit (overwrite or skip). */
  status: 'created' | 'failed' | 'conflict' | 'skipped'
  entity_id: string | null
  error: { code: string; message: string } | null
  conflict: ImportConflict | null
}

/** One kind of record an import can create: what the review table shows and what can be edited. */
export type ImportKindConfig = {
  /** "Clients", also the option Heidi offers. */
  label: string
  /** The page that lists them, where the import drawer opens. */
  path: string
  /** The field that names a record in the review (default `name`, e.g. `title` for engagements). */
  labelKey?: string
  /** Every shown field's label. */
  fields: Record<string, string>
  columns: string[]
  editable: string[]
  /** Records belong to an existing client: `client_id` (in `editable`) is picked with the client search, which also
   * sets `client_name`. */
  pickClient?: boolean
  /** Yes/no fields, edited with a checkbox and sent as booleans. */
  toggles?: string[]
  /** Help behind a (?) next to a field's label in the editor. */
  tips?: Record<string, string>
  /** Query key prefix of the page's lists, refetched after a commit. */
  listKey: readonly string[]
  entityHref: (id: string) => string
}

export const IMPORT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx,.docx,.zip'
export const IMPORT_FILE_TYPES =
  'PDF, photos (PNG, JPEG, WEBP), Excel (.xlsx), Word (.docx), CSV or text, or a ZIP of them'
export const MAX_IMPORT_FILES = 10
export const MAX_IMPORT_FILE_BYTES = MAX_FILE_BYTES

/** The registered kinds (docs/imports-contract.md, "Adding a kind"): one entry per kind the Go API registers. */
export const IMPORT_KINDS = {
  clients: {
    label: 'Clients',
    path: '/clients',
    fields: {
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      street: 'Street',
      street_number: 'No.',
      zip: 'Postcode',
      city: 'City',
      country: 'Country',
      vat_number: 'VAT number',
      registration_number: 'Registration number',
    },
    columns: ['name', 'email', 'city', 'country', 'vat_number'],
    editable: [
      'name',
      'email',
      'phone',
      'street',
      'street_number',
      'zip',
      'city',
      'country',
      'vat_number',
      'registration_number',
    ],
    listKey: ['clients'],
    entityHref: (id) => `/clients?id=${encodeURIComponent(id)}`,
  },
  products: {
    label: 'Products & services',
    path: '/products',
    fields: {
      type: 'Type',
      name: 'Name',
      description: 'Description',
      sku: 'SKU',
      unit: 'Unit',
      unit_price: 'Price',
      currency: 'Currency',
      vat_rate: 'VAT rate',
    },
    columns: ['type', 'name', 'sku', 'unit', 'unit_price', 'currency'],
    editable: ['type', 'name', 'description', 'sku', 'unit', 'unit_price', 'currency', 'vat_rate'],
    listKey: ['products'],
    entityHref: (id) => `/products?id=${encodeURIComponent(id)}`,
  },
  engagements: {
    label: 'Engagements',
    path: '/engagements',
    fields: {
      client_id: 'Client',
      client_name: 'Client',
      title: 'Title',
      description: 'Description',
      quantity: 'Quantity',
      unit: 'Unit',
      unit_price: 'Price',
      currency: 'Currency',
      vat_rate: 'VAT rate',
      billing: 'Billing',
      recurrence: 'Repeats',
      interval: 'Every',
      start_date: 'Start',
      end_date: 'End',
      reference: 'Reference',
    },
    columns: ['client_name', 'title', 'quantity', 'unit', 'unit_price', 'recurrence', 'start_date'],
    editable: [
      'client_id',
      'title',
      'description',
      'quantity',
      'unit',
      'unit_price',
      'currency',
      'vat_rate',
      'billing',
      'recurrence',
      'interval',
      'start_date',
      'end_date',
      'reference',
    ],
    pickClient: true,
    labelKey: 'title',
    listKey: ['engagements'],
    entityHref: (id) => `/engagements?id=${encodeURIComponent(id)}`,
  },
  invoices: {
    label: 'Invoices',
    path: '/invoices',
    labelKey: 'number',
    fields: {
      client_id: 'Client',
      client_name: 'Billed to',
      number: 'Number',
      reference: 'Reference',
      issue_date: 'Date',
      due_date: 'Due',
      currency: 'Currency',
      total: 'Total',
      lines: 'Lines',
      issued_elsewhere: 'Already issued',
      paid_amount: 'Already paid',
      paid_on: 'Paid on',
    },
    columns: [
      'number',
      'client_name',
      'issue_date',
      'currency',
      'total',
      'lines',
      'issued_elsewhere',
    ],
    editable: [
      'client_id',
      'number',
      'reference',
      'issue_date',
      'due_date',
      'currency',
      'total',
      'issued_elsewhere',
      'paid_amount',
      'paid_on',
    ],
    toggles: ['issued_elsewhere'],
    tips: {
      issued_elsewhere:
        'Ticked: the invoice was already issued in another system. It keeps its number and stays open for what is unpaid; the uploaded file is its original. Unticked: it becomes a draft you issue yourself.',
      paid_amount:
        'What the client already paid on an invoice issued elsewhere. Leave it empty when nothing was paid.',
    },
    pickClient: true,
    listKey: ['invoices'],
    entityHref: (id) => `/invoices?id=${encodeURIComponent(id)}`,
  },
  expenses: {
    label: 'Expenses',
    labelKey: 'supplier_name',
    path: '/expenses',
    fields: {
      supplier_name: 'Supplier',
      supplier_vat_number: 'Supplier VAT number',
      supplier_country: 'Supplier country',
      reference: 'Reference',
      description: 'Description',
      document_date: 'Date',
      due_date: 'Due date',
      currency: 'Currency',
      amount: 'Amount',
      vat_rate: 'VAT rate',
      amount_2: 'Amount at 2nd rate',
      vat_rate_2: '2nd VAT rate',
      reverse_charge: 'Reverse charge',
    },
    columns: ['supplier_name', 'document_date', 'amount', 'currency', 'vat_rate', 'reference'],
    editable: [
      'supplier_name',
      'supplier_vat_number',
      'supplier_country',
      'reference',
      'description',
      'document_date',
      'due_date',
      'currency',
      'amount',
      'vat_rate',
      'amount_2',
      'vat_rate_2',
      'reverse_charge',
    ],
    toggles: ['reverse_charge'],
    listKey: ['expenses'],
    entityHref: (id) => `/expenses?id=${encodeURIComponent(id)}`,
  },
} satisfies Record<string, ImportKindConfig>

export type ImportKind = keyof typeof IMPORT_KINDS

export const isImportKind = (value: string): value is ImportKind => value in IMPORT_KINDS

/** The kind whose label is `label` ("Products & services" → products), as Heidi's form offers them. */
export function importKindByLabel(label: string): ImportKind | null {
  for (const kind of Object.keys(IMPORT_KINDS))
    if (isImportKind(kind) && IMPORT_KINDS[kind].label === label) return kind
  return null
}

// Responses are checked by hand: their records carry what a model read out of a file.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isNullableString = (value: unknown) => value === null || isString(value)
const isBatchStatus = (value: unknown) => value === 'extracting' || value === 'review'
const isKind = (value: unknown): value is ImportKind => isString(value) && isImportKind(value)
const isTarget = (value: unknown): value is ImportTarget => value === 'auto' || isKind(value)
const isDocumentType = (value: unknown) =>
  value === null || value === undefined || (isString(value) && value in DOCUMENT_TYPES)

function isFile(value: unknown): value is ImportFile {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.name) &&
    typeof value.size === 'number' &&
    ['queued', 'extracting', 'done', 'failed'].includes(String(value.status)) &&
    isNullableString(value.error) &&
    typeof value.chunks_done === 'number' &&
    (value.chunks_total === null || typeof value.chunks_total === 'number') &&
    typeof value.reused === 'boolean' &&
    isDocumentType(value.document_type)
  )
}

const isScalar = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value)
const isLine = (value: unknown): value is ImportLine =>
  isObject(value) && Object.values(value).every(isScalar)
const isValue = (value: unknown): value is ImportValue =>
  isScalar(value) || (Array.isArray(value) && value.every(isLine))

function isDuplicate(value: unknown) {
  return (
    value === null ||
    (isObject(value) && isString(value.id) && isString(value.label) && isString(value.reason))
  )
}

export function isImportRecord(value: unknown): value is ImportRecord {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.file_id) &&
    isKind(value.kind) &&
    ['pending', 'created', 'failed', 'skipped'].includes(String(value.status)) &&
    isObject(value.data) &&
    Object.values(value.data).every(isValue) &&
    isObject(value.issues) &&
    Object.values(value.issues).every(isString) &&
    isDuplicate(value.duplicate) &&
    isNullableString(value.entity_id) &&
    isNullableString(value.error)
  )
}

export function isImportBatch(value: unknown): value is ImportBatch {
  return (
    isObject(value) &&
    isString(value.id) &&
    isTarget(value.kind) &&
    isBatchStatus(value.status) &&
    isString(value.created_at) &&
    Array.isArray(value.files) &&
    value.files.every(isFile) &&
    Array.isArray(value.records) &&
    value.records.every(isImportRecord)
  )
}

function isSummary(value: unknown): value is ImportSummary {
  return (
    isObject(value) &&
    isString(value.id) &&
    isTarget(value.kind) &&
    isBatchStatus(value.status) &&
    isString(value.created_at) &&
    typeof value.pending === 'number'
  )
}

function isConflict(value: unknown): value is ImportConflict {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.label) &&
    isString(value.reason) &&
    typeof value.can_overwrite === 'boolean' &&
    isNullableString(value.why_not)
  )
}

function isCommitResult(value: unknown): value is CommitResult {
  return (
    isObject(value) &&
    isString(value.id) &&
    ['created', 'failed', 'conflict', 'skipped'].includes(String(value.status)) &&
    isNullableString(value.entity_id) &&
    (value.error === null ||
      (isObject(value.error) && isString(value.error.code) && isString(value.error.message))) &&
    (value.conflict === null || isConflict(value.conflict))
  )
}

/** `body.data` when it passes `guard`; anything else is a broken answer, not data to show. */
function dataOf<T>(body: unknown, guard: (value: unknown) => value is T): T {
  if (isObject(body) && guard(body.data)) return body.data
  throw new ApiError(
    0,
    'invalid_response',
    'Helvetly sent an answer the page cannot read. Try again.',
  )
}

const isSummaries = (value: unknown): value is ImportSummary[] =>
  Array.isArray(value) && value.every(isSummary)
const isCommit = (value: unknown): value is { results: CommitResult[]; batch: ImportBatch } =>
  isObject(value) &&
  Array.isArray(value.results) &&
  value.results.every(isCommitResult) &&
  isImportBatch(value.batch)

const path = (id: string) => `/imports/${encodeURIComponent(id)}`

export type RecordChanges = Record<string, string | boolean | null>

export type CommitInput = { recordIds: string[]; resolutions?: Record<string, Resolution> }

export const importsApi = {
  upload: async (kind: ImportTarget, files: File[]) => {
    const form = new FormData()
    form.append('kind', kind)
    for (const file of files) form.append('files[]', file)
    return dataOf(await request<unknown>('/imports', { method: 'POST', form }), isImportBatch)
  },
  list: async (kind: ImportTarget) =>
    dataOf(await request<unknown>(`/imports?${new URLSearchParams({ kind })}`), isSummaries),
  get: async (id: string) => dataOf(await request<unknown>(path(id)), isImportBatch),
  patchRecord: async (id: string, recordId: string, data: RecordChanges) =>
    dataOf(
      await request<unknown>(`${path(id)}/records/${encodeURIComponent(recordId)}`, {
        method: 'PATCH',
        json: { data },
      }),
      isImportRecord,
    ),
  commit: async (id: string, { recordIds, resolutions = {} }: CommitInput) =>
    dataOf(
      await request<unknown>(`${path(id)}/commit`, {
        method: 'POST',
        json: { record_ids: recordIds, resolutions },
      }),
      isCommit,
    ),
  discard: (id: string) => request<void>(path(id), { method: 'DELETE' }),
}

export const importKeys = {
  list: (kind: ImportTarget) => ['imports', 'list', kind] as const,
  batch: (id: string) => ['imports', 'batch', id] as const,
}

/** Polls every 2 s while the files are still being read. */
export const pollInterval = (batch: ImportBatch | undefined) =>
  batch?.status === 'extracting' ? 2000 : false

export function useImportBatches(kind: ImportTarget) {
  return useQuery({
    queryKey: importKeys.list(kind),
    queryFn: () => importsApi.list(kind),
    staleTime: 0,
  })
}

export function useImportBatch(id: string | null) {
  return useQuery({
    queryKey: importKeys.batch(id ?? ''),
    queryFn: () => importsApi.get(id ?? ''),
    enabled: id !== null,
    staleTime: 0,
    refetchInterval: (query) => pollInterval(query.state.data),
  })
}

export function useUploadImport(kind: ImportTarget) {
  const queryClient = useQueryClient()
  return useMutation<ImportBatch, ApiError, File[]>({
    mutationFn: (files) => importsApi.upload(kind, files),
    onSuccess: (batch) => {
      queryClient.setQueryData(importKeys.batch(batch.id), batch)
      void queryClient.invalidateQueries({ queryKey: importKeys.list(kind) })
    },
  })
}

export function usePatchImportRecord(batchId: string) {
  const queryClient = useQueryClient()
  return useMutation<ImportRecord, ApiError, { recordId: string; data: RecordChanges }>({
    mutationFn: ({ recordId, data }) => importsApi.patchRecord(batchId, recordId, data),
    onSuccess: (record) =>
      queryClient.setQueryData<ImportBatch>(
        importKeys.batch(batchId),
        (batch) =>
          batch && {
            ...batch,
            records: batch.records.map((entry) => (entry.id === record.id ? record : entry)),
          },
      ),
  })
}

export function useCommitImport(kind: ImportTarget, batchId: string) {
  const queryClient = useQueryClient()
  return useMutation<{ results: CommitResult[]; batch: ImportBatch }, ApiError, CommitInput>({
    mutationFn: (input) => importsApi.commit(batchId, input),
    onSuccess: ({ batch }) => {
      queryClient.setQueryData(importKeys.batch(batch.id), batch)
      void queryClient.invalidateQueries({ queryKey: importKeys.list(kind) })
      for (const target of kind === 'auto' ? Object.values(IMPORT_KINDS) : [IMPORT_KINDS[kind]])
        void queryClient.invalidateQueries({ queryKey: target.listKey })
    },
  })
}

export function useDiscardImport(kind: ImportTarget) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: importsApi.discard,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: importKeys.batch(id) })
      void queryClient.invalidateQueries({ queryKey: importKeys.list(kind) })
    },
  })
}

// Pure helpers for the drawer.

/** Created or skipped: nothing left to choose for it (an edit takes a skipped record up again). */
export const isSettled = (record: ImportRecord) =>
  record.status === 'created' || record.status === 'skipped'

export const isClean = (record: ImportRecord) =>
  !isSettled(record) && !record.duplicate && Object.keys(record.issues).length === 0

/** Rows ticked when the review opens: clean ones; duplicates and rows with issues wait for a look. */
export const defaultSelection = (records: ImportRecord[]) =>
  new Set(records.filter(isClean).map((record) => record.id))

/** The newest batch worth reopening: still being read, or with records not created yet. */
export const resumable = (batches: ImportSummary[]) =>
  batches.find((batch) => batch.pending > 0 || batch.status === 'extracting') ?? null

/** The records of an `auto` import by kind, in the order the review shows them (and a commit creates them). */
export function recordsByKind(records: ImportRecord[]) {
  const order: ImportKind[] = ['clients', 'products', 'invoices', 'engagements', 'expenses']
  return order
    .map((kind) => ({ kind, records: records.filter((record) => record.kind === kind) }))
    .filter((group) => group.records.length > 0)
}

/** "5 invoices, 5 clients and 1 engagement": what an `auto` import found, for a summary line. */
export function foundSummary(records: ImportRecord[]) {
  const parts = recordsByKind(records).map(({ kind, records: list }) => {
    const noun = IMPORT_KINDS[kind].label.toLowerCase()
    return `${list.length} ${list.length === 1 ? (SINGULAR[kind] ?? noun) : noun}`
  })
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

const SINGULAR: Partial<Record<ImportKind, string>> = {
  clients: 'client',
  products: 'product or service',
  invoices: 'invoice',
  engagements: 'engagement',
  expenses: 'expense',
}

/** "8 created, 1 skipped, 2 need attention" after a commit. */
export function commitSummary(results: CommitResult[]) {
  const count = (status: CommitResult['status']) =>
    results.filter((result) => result.status === status).length
  const created = count('created')
  const skipped = count('skipped')
  const open = results.length - created - skipped
  const parts = [`${created} created`]
  if (skipped) parts.push(`${skipped} skipped`)
  if (open) parts.push(`${open} ${open === 1 ? 'needs' : 'need'} attention`)
  return parts.join(', ')
}

/** The records a commit could not create because they collide with existing ones. */
export const conflictsOf = (results: CommitResult[]) =>
  results.flatMap((result) =>
    result.status === 'conflict' && result.conflict
      ? [{ ...result, conflict: result.conflict }]
      : [],
  )

/** Every record's choice when "apply to all" is used: overwrite only where it is allowed. */
export function applyToAll(
  conflicts: { id: string; conflict: ImportConflict }[],
  resolution: Resolution,
): Record<string, Resolution> {
  return Object.fromEntries(
    conflicts.map(({ id, conflict }) => [
      id,
      resolution === 'overwrite' && conflict.can_overwrite ? 'overwrite' : 'skip',
    ]),
  )
}

/** The changed fields as a PATCH body: trimmed, an emptied field cleared with null, a toggle ("Yes"/"No") as a boolean. */
export function recordChanges(
  data: Record<string, ImportValue>,
  values: Record<string, string>,
  toggles: readonly string[] = [],
): RecordChanges {
  const changes: RecordChanges = {}
  for (const [field, raw] of Object.entries(values)) {
    const value = raw.trim()
    if (value === displayValue(data[field])) continue
    if (toggles.includes(field)) changes[field] = value === 'Yes'
    else changes[field] = value === '' ? null : value
  }
  return changes
}

export function displayValue(value: ImportValue | undefined) {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'line' : 'lines'}`
  return String(value)
}

export type ImportProblem = {
  kind: 'consent' | 'not_configured' | 'plan' | 'file' | 'retry'
  title: string
  message: string
}

/** What went wrong with an upload or a read, for someone who has never heard of an API. */
export function importProblem(error: unknown): ImportProblem {
  // A proxy may refuse a big upload with its own 413 page instead of the API's JSON error.
  if (error instanceof ApiError && error.status === 413 && error.code !== 'payload_too_large')
    return {
      kind: 'file',
      title: 'These files cannot be read',
      message: 'The upload is too large: up to 10 files of 25 MB each, 95 MB in all.',
    }
  const code = error instanceof ApiError ? error.code : ''
  const message = error instanceof Error ? error.message : ''
  switch (code) {
    case 'ai_consent_required':
      return {
        kind: 'consent',
        title: 'AI reading is not allowed yet',
        message:
          'Reading files uses Heidi’s AI model (OpenAI). An owner or admin has to allow Heidi to use OpenAI first, in Heidi’s panel.',
      }
    case 'ai_not_configured':
      return {
        kind: 'not_configured',
        title: 'No AI model is set up',
        message:
          'This Helvetly server has no AI model configured, so it cannot read files. Ask whoever runs it to set one up.',
      }
    case 'limit_reached':
    case 'plan_required':
      return { kind: 'plan', title: 'Your plan does not allow this', message }
    case 'unsupported_file':
    case 'duplicate_file':
    case 'payload_too_large':
    case 'invalid_request':
      return { kind: 'file', title: 'These files cannot be read', message }
    default:
      return {
        kind: 'retry',
        title: 'Something went wrong',
        message: message || 'Something went wrong. Try again.',
      }
  }
}
