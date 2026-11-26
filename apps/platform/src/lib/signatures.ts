'use client'
// Signatures, typed by hand from docs/signatures-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, type ApiError } from '@/lib/api'
import { refreshDocuments } from '@/lib/documents'
import type { EmailLanguage, EmailPreview } from '@/lib/email-templates'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

export type RequestStatus = 'pending' | 'completed' | 'declined' | 'revoked' | 'expired'
export type SignerStatus = 'waiting' | 'sent' | 'viewed' | 'signed' | 'declined'
export type FieldKind = 'signature' | 'date' | 'name' | 'text'
export type SigningOrder = 'parallel' | 'sequential'

export type Signer = {
  id: string
  position: number
  name: string
  email: string
  status: SignerStatus
  sent_at: string | null
  viewed_at: string | null
  signed_at: string | null
  declined_at: string | null
  decline_reason: string | null
}

/** A box on a page in fractions (0–1) of the page, from its top-left corner. */
export type Box = { page: number; x: number; y: number; w: number; h: number }

export type Field = Box & {
  id: string
  signer_id: string
  kind: FieldKind
  label: string | null
  value: string | null
}

export type SignatureEvent = {
  type: 'created' | 'sent' | 'viewed' | 'signed' | 'declined' | 'reminded' | 'revoked' | 'completed'
  signer: { id: string; name: string; email: string } | null
  at: string
  ip: string | null
  user_agent: string | null
  hash: string
}

export type SignatureRequest = {
  id: string
  title: string
  message: string | null
  /** The language its emails are written in; null for a request from before email templates. */
  language?: EmailLanguage | null
  status: RequestStatus
  signing_order: SigningOrder
  document: { id: string; name: string } | null
  signed_document: { id: string; name: string } | null
  folder_id: string | null
  original_sha256: string
  final_sha256: string | null
  page_count: number
  expires_at: string
  created_by: { id: string; name: string; avatar_url?: string | null } | null
  created_at: string
  completed_at: string | null
  signers: Signer[]
  fields: Field[]
  events?: SignatureEvent[]
}

/** A field being placed; templates also place client-data kinds, hence the parameter. */
export type DraftField<K extends string = FieldKind> = Box & {
  /** Client-side id, for selection and keys. */
  key: string
  /** 0-based index into the signers (in a template: into its lanes). */
  signer: number
  kind: K
  label: string | null
}

export type CreateSignatureRequest = {
  document_id: string
  title: string
  message?: string | null
  language?: EmailLanguage
  signing_order: SigningOrder
  expires_in_days?: number
  signers: { name: string; email: string }[]
  fields: (Box & { signer: number; kind: FieldKind; label?: string | null })[]
}

export type SigningView = {
  request: {
    title: string
    message: string | null
    status: RequestStatus
    sender: { name: string; email: string }
    /** The business as its emails name it. */
    workspace: string
    /** Its email logo (a public path), empty for none. */
    logo: string
    expires_at: string
    page_count: number
  }
  signer: { id: string; name: string; email: string; status: SignerStatus }
  fields: Field[]
  consent_text: string
}

export type Sign = {
  consent: true
  signature: { method: 'typed' | 'drawn'; image: string }
  values: Record<string, string>
}

// ---- the field placement model (pure) ----

/** Default box sizes as fractions of an A4-ish page. */
export const DEFAULT_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.28, h: 0.06 },
  date: { w: 0.16, h: 0.03 },
  name: { w: 0.24, h: 0.03 },
  text: { w: 0.24, h: 0.03 },
}
const SIZES: Partial<Record<string, { w: number; h: number }>> = DEFAULT_SIZE

/**
 * The smallest a box of a kind may get, so what is stamped or signed in it stays legible: about one
 * line of text (an A4 page is ~842pt tall, so 0.02 ≈ 17pt), a signature a little taller and wider.
 */
const MIN_SIZES: Partial<Record<string, { w: number; h: number }>> = {
  signature: { w: 0.14, h: 0.04 },
  date: { w: 0.1, h: 0.02 },
  today: { w: 0.1, h: 0.02 },
  'client.address': { w: 0.16, h: 0.04 }, // two lines
}
const MIN_TEXT = { w: 0.08, h: 0.02 }

/** The minimum box of a field kind; plain text for kinds without their own. */
export const minSize = (kind?: string) => (kind && MIN_SIZES[kind]) || MIN_TEXT

export const FIELD_LABELS: Record<FieldKind, string> = {
  signature: translate('signature'),
  date: translate('dateSigned'),
  name: translate('name'),
  text: translate('text'),
}

/** Signer colours by index: distinct, calm hues that read in light and dark mode. */
export const SIGNER_COLORS = [
  '#2f6fdf', // blue
  '#d9772b', // orange
  '#2f9461', // green
  '#9a4fd0', // violet
  '#d14a7c', // pink
  '#1f9bb0', // teal
  '#b8902a', // ochre
  '#5b6bd6', // indigo
  '#c2513d', // brick
  '#5f8f2f', // olive
] as const

export const signerColor = (index: number) =>
  SIGNER_COLORS[index % SIGNER_COLORS.length] ?? '#2f6fdf'

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The box kept on its page: at least its kind's minimum, at most the page, fully inside it. */
export function clampBox<T extends Box & { kind?: string }>(box: T): T {
  const min = minSize(box.kind)
  const w = clamp(box.w, min.w, 1)
  const h = clamp(box.h, min.h, 1)
  return { ...box, w, h, x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h) }
}

let counter = 0
const newKey = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`

/** A field of `kind` for `signer`, centred on (cx, cy) of `page`. */
export function addField<K extends string>(
  fields: DraftField<K>[],
  kind: K,
  signer: number,
  page: number,
  cx: number,
  cy: number,
  size = SIZES[kind] ?? DEFAULT_SIZE.text,
): DraftField<K>[] {
  const { w, h } = size
  return [
    ...fields,
    clampBox({
      key: newKey(),
      kind,
      signer,
      page,
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      label: null,
    }),
  ]
}

type Placed = Box & { key: string; signer: number; kind?: string }

export const moveField = <T extends Placed>(fields: T[], key: string, dx: number, dy: number) =>
  fields.map((field) =>
    field.key === key ? clampBox({ ...field, x: field.x + dx, y: field.y + dy }) : field,
  )

/** Resize from the bottom-right corner; the top-left stays put. */
export const resizeField = <T extends Placed>(fields: T[], key: string, dw: number, dh: number) =>
  fields.map((field) =>
    field.key === key
      ? {
          ...field,
          w: clamp(field.w + dw, minSize(field.kind).w, 1 - field.x),
          h: clamp(field.h + dh, minSize(field.kind).h, 1 - field.y),
        }
      : field,
  )

/** Where a snapped box lines up: x and y positions on the page (0..1), null when not snapped. */
export type Guides = { x: number | null; y: number | null }

/** The edges and middle of a span [start, start + size]. */
const lines = (start: number, size: number) => [start, start + size / 2, start + size]

/** The smallest shift that puts one of `own` within `reach` of one of `targets`, or null. */
function nearest(own: number[], targets: number[], reach: number) {
  let best: { shift: number; at: number } | null = null
  for (const line of own)
    for (const target of targets) {
      const shift = target - line
      if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift)))
        best = { shift, at: target }
    }
  return best
}

/**
 * Snap a moved or resized box to the other boxes on its page and to the page's centre: a move lines up
 * its left, centre or right (top, middle or bottom) with theirs, a resize only its right and bottom
 * edges. `reach` is the snap distance per axis, in page fractions.
 */
export function snapBox<T extends Box>(
  box: T,
  others: Box[],
  mode: 'move' | 'resize',
  reach: { x: number; y: number },
): { box: T; guides: Guides } {
  const peers = others.filter((other) => other.page === box.page)
  const xs = [0.5, ...peers.flatMap((other) => lines(other.x, other.w))]
  const ys = [0.5, ...peers.flatMap((other) => lines(other.y, other.h))]
  const ownX = mode === 'move' ? lines(box.x, box.w) : [box.x + box.w]
  const ownY = mode === 'move' ? lines(box.y, box.h) : [box.y + box.h]
  const sx = nearest(ownX, xs, reach.x)
  const sy = nearest(ownY, ys, reach.y)
  const dx = sx?.shift ?? 0
  const dy = sy?.shift ?? 0
  const snapped =
    mode === 'move'
      ? { ...box, x: box.x + dx, y: box.y + dy }
      : { ...box, w: box.w + dx, h: box.h + dy }
  return { box: snapped, guides: { x: sx?.at ?? null, y: sy?.at ?? null } }
}

export const deleteField = <T extends Placed>(fields: T[], key: string) =>
  fields.filter((field) => field.key !== key)

export const updateField = <T extends Placed>(fields: T[], key: string, change: Partial<T>) =>
  fields.map((field) => (field.key === key ? { ...field, ...change } : field))

/** After signer `index` is removed: their fields go, later signers' indexes shift down. */
export const dropSigner = <T extends Placed>(fields: T[], index: number) =>
  fields.flatMap((field) =>
    field.signer === index
      ? []
      : field.signer > index
        ? [{ ...field, signer: field.signer - 1 }]
        : [field],
  )

/** After signers `from` and `to` swap places: their fields follow them. */
export const swapSigners = <T extends Placed>(fields: T[], from: number, to: number) =>
  fields.map((field) =>
    field.signer === from
      ? { ...field, signer: to }
      : field.signer === to
        ? { ...field, signer: from }
        : field,
  )

/** Indexes of the signers who have no signature field yet. */
export const signersWithoutSignature = (fields: DraftField[], signerCount: number) =>
  Array.from({ length: signerCount }, (_, index) => index).filter(
    (index) => !fields.some((field) => field.signer === index && field.kind === 'signature'),
  )

export type DraftSigner = { name: string; email: string }

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Problems with the signers, by row, plus a list-level one (empty when fine). */
export function checkSigners(signers: DraftSigner[]) {
  const rows = signers.map((signer, index) => {
    const email = signer.email.trim().toLowerCase()
    return {
      name: signer.name.trim() ? '' : translate('enterAName'),
      email: !email
        ? translate('enterAnEmailAddress')
        : !EMAIL.test(email)
          ? translate('enterAValidEmailAddress')
          : signers.findIndex((other) => other.email.trim().toLowerCase() === email) < index
            ? translate('thisPersonIsAlreadyASigner')
            : '',
    }
  })
  const list =
    signers.length === 0
      ? translate('addAtLeastOneSigner')
      : signers.length > 10
        ? translate('useAtMost10Signers')
        : ''
  return { rows, list, ok: !list && rows.every((row) => !row.name && !row.email) }
}

export function buildCreateBody(input: {
  documentId: string
  title: string
  message: string
  language?: EmailLanguage
  order: SigningOrder
  expiresInDays: number
  signers: DraftSigner[]
  fields: DraftField[]
}): CreateSignatureRequest {
  return {
    document_id: input.documentId,
    title: input.title.trim(),
    message: input.message.trim() || null,
    ...(input.language ? { language: input.language } : {}),
    signing_order: input.order,
    expires_in_days: input.expiresInDays,
    signers: input.signers.map((signer) => ({
      name: signer.name.trim(),
      email: signer.email.trim().toLowerCase(),
    })),
    fields: input.fields.map(({ signer, page, kind, x, y, w, h, label }) => ({
      signer,
      page,
      kind,
      x,
      y,
      w,
      h,
      label: kind === 'text' ? label?.trim() || null : null,
    })),
  }
}

/** A file name without its extension (".pdf", ".docx"…), as a default title; nothing else is guessed away. */
export const titleFromName = (name: string) =>
  name.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || name.trim()

/** Signed so far, out of all signers. */
/** Who a reminder goes to (the API's due signers): none unless out for signature; one after another, the signer
 *  whose turn it is; everyone at once, all who have not signed. */
export const remindTargets = ({ status, signing_order, signers }: SignatureRequest): Signer[] => {
  if (status !== 'pending') return []
  const unsigned = signers
    .filter((signer) => signer.status !== 'signed' && signer.status !== 'declined')
    .toSorted((a, b) => a.position - b.position)
  return signing_order === 'sequential' ? unsigned.slice(0, 1) : unsigned
}

export const progressOf = ({ signers }: SignatureRequest) => ({
  signed: signers.filter((signer) => signer.status === 'signed').length,
  total: signers.length,
})

// ---- the API ----

const path = (id: string) => `/signatures/${encodeURIComponent(id)}`
const publicPath = (token: string) => `/public/sign/${encodeURIComponent(token)}`

export const signaturesApi = {
  list: (query: { document_id?: string; status?: RequestStatus } = {}) => {
    const params = new URLSearchParams()
    if (query.document_id) params.set('document_id', query.document_id)
    if (query.status) params.set('status', query.status)
    const text = params.toString()
    return request<{ data: SignatureRequest[] }>(`/signatures${text ? `?${text}` : ''}`)
  },
  create: (body: CreateSignatureRequest) =>
    request<{ data: SignatureRequest }>('/signatures', { method: 'POST', json: body }),
  get: (id: string) => request<{ data: SignatureRequest }>(path(id)),
  remind: (id: string) =>
    request<{ data: SignatureRequest }>(`${path(id)}/remind`, { method: 'POST' }),
  revoke: (id: string) =>
    request<{ data: SignatureRequest }>(`${path(id)}/revoke`, { method: 'POST' }),
  /** The invitation a signer would get, as the real branded email; nothing is sent. */
  emailPreview: (body: {
    title: string
    message: string
    language: EmailLanguage
    expires_in_days: number
  }) =>
    request<{ data: EmailPreview }>('/signatures/email-preview', { method: 'POST', json: body }),

  view: (token: string) => request<{ data: SigningView }>(publicPath(token), { public: true }),
  sign: (token: string, body: Sign) =>
    request<{ data: SigningView }>(publicPath(token), { method: 'POST', json: body, public: true }),
  decline: (token: string, reason: string) =>
    request<{ data: SigningView }>(`${publicPath(token)}/decline`, {
      method: 'POST',
      json: { reason },
      public: true,
    }),
}

export const originalUrl = (id: string) => `/api/v1${path(id)}/original`
export const signingDocumentUrl = (token: string) => `/api/v1${publicPath(token)}/document`

// Under documents, so refreshDocuments (after any file write) refreshes these too.
export const signatureKeys = {
  all: [...queryKeys.documents, 'signatures'] as const,
  list: (status: string) => [...queryKeys.documents, 'signatures', 'list', status] as const,
  detail: (id: string) => [...queryKeys.documents, 'signatures', 'detail', id] as const,
}

export function useSignatureRequests(status: RequestStatus | null, enabled = true) {
  return useQuery({
    queryKey: signatureKeys.list(status ?? 'all'),
    queryFn: async () => (await signaturesApi.list(status ? { status } : {})).data,
    enabled,
  })
}

export function useSignatureRequest(id: string | null) {
  return useQuery({
    queryKey: signatureKeys.detail(id ?? ''),
    queryFn: async () => (await signaturesApi.get(id ?? '')).data,
    enabled: id !== null,
  })
}

/** A write on a request; its answer replaces the cached detail, the lists refetch. */
export function useSignatureMutation<Input>(
  fn: (input: Input) => Promise<{ data: SignatureRequest }>,
) {
  const queryClient = useQueryClient()
  return useMutation<SignatureRequest, ApiError, Input>({
    mutationFn: async (input) => (await fn(input)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(signatureKeys.detail(data.id), data)
      refreshDocuments(queryClient)
    },
  })
}

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])

/** An audit event's address, labelled; a loopback one (a local run) says so. Display only. */
export const ipLabel = (ip: string) =>
  translate(LOOPBACK.has(ip) ? 'ipThisComputer' : 'ipAddress', { ip })
