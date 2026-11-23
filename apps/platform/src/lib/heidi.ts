// Heidi, typed by hand from docs/heidi-contract.md.
import { locale } from '@helvetly/i18n'

import { request, respond } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { IMPORT_ACCEPT } from '@/lib/imports'
import { STATUS_LABELS, type DisplayStatus } from '@/lib/invoices'
import { STATUSES as SESSION_STATUSES, type Status as SessionStatus } from '@/lib/scheduling'

export type HeidiAction =
  | { id: 'open_client'; client_id: string; label: string }
  | { id: 'open_engagement'; engagement_id: string; label: string }
  | { id: 'open_invoice'; invoice_id: string; label: string }
  | { id: 'open_session'; occurrence_id: string; label: string }
  | { id: 'create_invoice'; label: string }
  | { id: 'list_overdue_invoices'; label: string }
  | { id: 'send_invoice'; invoice_id: string; label: string; subject: string }

/** A workspace record shown as a card under an answer; it opens in place. */
export type HeidiRecord =
  | {
      kind: 'client'
      id: string
      title: string
      detail?: string
      status: 'active' | 'inactive' | 'draft'
    }
  | {
      kind: 'invoice'
      id: string
      title: string
      detail?: string
      status: DisplayStatus
      amount: string
      currency: string
    }
  | {
      kind: 'engagement'
      id: string
      title: string
      detail?: string
      progress?: { used: string; available: string; unit: string }
    }
  | {
      kind: 'session'
      id: string
      title: string
      detail?: string
      status: SessionStatus
    }

export const MAX_RECORDS = 20

export type HeidiField =
  | { kind: 'choice' | 'multichoice'; name: string; label: string; options: string[] }
  | { kind: 'record'; name: string; label: string; record: 'client' | 'invoice' }
  | { kind: 'file'; name: string; label: string; accept: string[] }

export type HeidiForm = { id: string; question: string; intent?: 'import'; fields: HeidiField[] }

export type HeidiConfirmation = {
  type: 'confirmation'
  id: string
  title: string
  body: string
  confirm_label: string
  tone: 'default' | 'destructive'
}

/** Who wrote an answer (AI Act Art. 50(2)): the AI model, or Helvetly itself (local command, guide, refusal). */
export type HeidiGeneratedBy = 'model' | 'helvetly'

export type HeidiEvent =
  | { type: 'text'; value: string; generated_by?: HeidiGeneratedBy }
  | { type: 'status'; label: string }
  | { type: 'actions'; actions: HeidiAction[] }
  | { type: 'records'; records: HeidiRecord[] }
  | { type: 'form'; form: HeidiForm }
  | { type: 'import'; import_id: string }
  | HeidiConfirmation
  | { type: 'done'; usage: { tokens: number } }
  | { type: 'error'; code?: string; message: string }

/** One message of a stored conversation (`GET /conversations/{id}`). */
export type HeidiMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  attachments?: string[]
  actions?: HeidiAction[]
  records?: HeidiRecord[]
  form?: HeidiForm
  /** The import this answer reports on: the chat shows its progress and review. */
  import_id?: string
  confirmation?: HeidiConfirmation
  /** Set on assistant messages. */
  generated_by?: HeidiGeneratedBy
  /** When the message was stored (RFC 3339). */
  created_at?: string
}

/** One entry of the chat history (`GET /conversations`). */
export type HeidiConversation = {
  id: string
  title: string
  /** The start of the latest answer; empty when there is none yet. */
  snippet?: string
  messages?: number
  updated_at: string
}

export type HeidiUsage = {
  period: string
  tokens_used: number
  /** `null`: no plan caps the workspace's model tokens (billing off). */
  tokens_included: number | null
  tokens_purchased: number
  tokens_remaining: number | null
  mode?: 'local' | 'openai'
  usage_uncertain?: boolean
  can_purchase?: boolean
  /** The server has an AI model; it is used only once the person approves it in this workspace. */
  provider_available?: boolean
  consent?: HeidiConsent
}

/** The signed-in person's own approval, in this workspace, to send content to OpenAI; changed_at is null until they choose. */
export const usageKey = ['heidi', 'usage'] as const

/**
 * `granted`: approved the notice in force (`current_version`); `version` is the notice the latest choice was made for
 * ("" before notice versions or any choice).
 */
export type HeidiConsent = {
  granted: boolean
  version: string
  current_version: string
  changed_at: string | null
  changed_by: string
}

/** The AI-use notice people approve, from the API in the page's language; point ids pick the icons. */
export type AINotice = {
  version: string
  title: string
  lead: string
  sections: { id: string; title: string; points: { id: string; text: string }[] }[]
}

export const consentKey = ['heidi', 'consent', locale] as const

export type HeidiSuggestion = { title: string; prompt: string }

export const HEIDI_PAGES = [
  'dashboard',
  'clients',
  'invoices',
  'expenses',
  'engagements',
  'documents',
  'products',
  'members',
  'billing',
  'settings',
] as const
export type HeidiPage = (typeof HEIDI_PAGES)[number]

export const MAX_MESSAGE = 4000
export const MAX_FILES = 4
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']

/** Heidi reads the file itself in the chat: an image or PDF up to 8 MB. */
export const chatReadable = (file: File) =>
  FILE_TYPES.includes(file.type) && file.size <= MAX_FILE_BYTES

/** An import can read it (spreadsheets, Word, CSV and ZIPs too), by its name as the import's picker does. */
export const importable = (file: File) =>
  IMPORT_ACCEPT.split(',').some((extension) => file.name.toLowerCase().endsWith(extension))

// The stems the API's own import check uses: English, German, French, Italian, Polish.
const IMPORT_STEMS = ['import', 'importier', 'importuj', 'importa']

/** The files go to an import that works out what each one is: the message asks to import them, or only an import
 * can take them (a ZIP, a spreadsheet, more than four files or a big one). */
export function goesToImport(text: string, files: File[]) {
  if (!files.length) return false
  const lower = text.toLowerCase()
  return (
    IMPORT_STEMS.some((stem) => lower.includes(stem)) ||
    files.length > MAX_FILES ||
    !files.every(chatReadable)
  )
}

// The stream is a trust boundary: frames are checked by hand and anything unknown is skipped.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const isString = (value: unknown): value is string => typeof value === 'string'
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

function isAction(value: unknown): value is HeidiAction {
  if (!isRecord(value) || !isString(value.label)) return false
  switch (value.id) {
    case 'open_client':
      return isString(value.client_id)
    case 'open_engagement':
      return isString(value.engagement_id)
    case 'open_invoice':
      return isString(value.invoice_id)
    case 'open_session':
      return isString(value.occurrence_id)
    case 'send_invoice':
      return isString(value.invoice_id) && isString(value.subject)
    case 'create_invoice':
    case 'list_overdue_invoices':
      return true
    default:
      return false
  }
}

const CLIENT_STATUSES = ['active', 'inactive', 'draft'] as const
const isClientStatus = (value: unknown): value is (typeof CLIENT_STATUSES)[number] =>
  CLIENT_STATUSES.some((status) => status === value)
const isDisplayStatus = (value: unknown): value is DisplayStatus =>
  isString(value) && Object.hasOwn(STATUS_LABELS, value)
const isOptionalString = (value: unknown) => value === undefined || isString(value)
const isSessionStatus = (value: unknown): value is SessionStatus =>
  SESSION_STATUSES.some((status) => status === value)

function toRecord(value: unknown): HeidiRecord | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.title)) return null
  if (!isOptionalString(value.detail)) return null
  const { id, title } = value
  const detail = isString(value.detail) ? value.detail : undefined
  switch (value.kind) {
    case 'client':
      return isClientStatus(value.status)
        ? { kind: 'client', id, title, detail, status: value.status }
        : null
    case 'invoice':
      return isDisplayStatus(value.status) && isString(value.amount) && isString(value.currency)
        ? {
            kind: 'invoice',
            id,
            title,
            detail,
            status: value.status,
            amount: value.amount,
            currency: value.currency,
          }
        : null
    case 'engagement': {
      const { progress } = value
      if (progress === undefined) return { kind: 'engagement', id, title, detail }
      if (
        !isRecord(progress) ||
        !isString(progress.used) ||
        !isString(progress.available) ||
        !isString(progress.unit)
      )
        return null
      return {
        kind: 'engagement',
        id,
        title,
        detail,
        progress: { used: progress.used, available: progress.available, unit: progress.unit },
      }
    }
    case 'session':
      return isSessionStatus(value.status)
        ? { kind: 'session', id, title, detail, status: value.status }
        : null
    default:
      return null
  }
}

function isField(value: unknown): value is HeidiField {
  if (!isRecord(value) || !isString(value.name) || !isString(value.label)) return false
  switch (value.kind) {
    case 'choice':
    case 'multichoice':
      return isStrings(value.options)
    case 'record':
      return value.record === 'client' || value.record === 'invoice'
    case 'file':
      return isStrings(value.accept)
    default:
      return false
  }
}

function isForm(value: unknown): value is HeidiForm {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.question) &&
    Array.isArray(value.fields) &&
    value.fields.every(isField)
  )
}

export function toHeidiEvent(value: unknown): HeidiEvent | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'text': {
      if (!isString(value.value)) return null
      const by = value.generated_by
      return by === 'model' || by === 'helvetly'
        ? { type: 'text', value: value.value, generated_by: by }
        : { type: 'text', value: value.value }
    }
    case 'status':
      return isString(value.label) ? { type: 'status', label: value.label } : null
    case 'actions':
      return Array.isArray(value.actions)
        ? { type: 'actions', actions: value.actions.filter(isAction).slice(0, 2) }
        : null
    case 'records':
      return Array.isArray(value.records)
        ? {
            type: 'records',
            records: value.records
              .map(toRecord)
              .filter((record) => record !== null)
              .slice(0, MAX_RECORDS),
          }
        : null
    case 'form':
      return isForm(value.form) ? { type: 'form', form: value.form } : null
    case 'import':
      return isString(value.import_id) ? { type: 'import', import_id: value.import_id } : null
    case 'confirmation': {
      const { id, title, body, confirm_label: confirmLabel, tone } = value
      if (!isString(id) || !isString(title) || !isString(body) || !isString(confirmLabel))
        return null
      return {
        type: 'confirmation',
        id,
        title,
        body,
        confirm_label: confirmLabel,
        tone: tone === 'destructive' ? 'destructive' : 'default',
      }
    }
    case 'done': {
      const tokens = isRecord(value.usage) ? value.usage.tokens : 0
      return { type: 'done', usage: { tokens: typeof tokens === 'number' ? tokens : 0 } }
    }
    case 'error':
      return isString(value.message)
        ? {
            type: 'error',
            message: value.message,
            ...(isString(value.code) && { code: value.code }),
          }
        : null
    default:
      return null
  }
}

/**
 * Splits Server-Sent Events text into events. Feed it chunks as they arrive: a frame cut in two
 * waits in the buffer for its end. Frames that aren't JSON or aren't a known event are skipped.
 */
export function createEventParser(onEvent: (event: HeidiEvent) => void) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk.replaceAll('\r\n', '\n')
    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      end = buffer.indexOf('\n\n')
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        const event = toHeidiEvent(JSON.parse(data))
        if (event) onEvent(event)
      } catch {
        // Not JSON: skipped like any unknown frame.
      }
    }
  }
}

/** Reads a stream response to its end, calling `onEvent` for every event. */
export async function readEvents(response: Response, onEvent: (event: HeidiEvent) => void) {
  if (!response.body) return
  const parse = createEventParser(onEvent)
  await response.body
    .pipeThrough(new TextDecoderStream())
    .pipeTo(new WritableStream({ write: (chunk) => parse(chunk) }))
}

export const heidiApi = {
  chat: (form: FormData, signal: AbortSignal) =>
    respond('/heidi/chat', { method: 'POST', form, signal }),
  confirm: (
    body: { conversation_id: string; confirmation_id: string; approved: boolean },
    signal: AbortSignal,
  ) => respond('/heidi/chat/confirm', { method: 'POST', json: body, signal }),
  conversations: () => request<{ data: HeidiConversation[] }>('/heidi/conversations'),
  conversation: (id: string) =>
    request<{ data: HeidiMessage[] }>(`/heidi/conversations/${encodeURIComponent(id)}`),
  usage: () => request<HeidiUsage>('/heidi/usage'),
  consent: () =>
    request<{ data: HeidiConsent; notice: AINotice }>(
      `/heidi/consent?${new URLSearchParams({ lang: locale })}`,
    ),
  /** Approving names the notice version that was shown; the server refuses any other (ai_consent_version_changed). */
  setConsent: (granted: boolean, version: string) =>
    request<{ data: HeidiConsent }>('/heidi/consent', {
      method: 'PUT',
      json: { granted, version },
    }),
  /** The page's suggestions; `client` is the client open in its drawer, whose topics come first. */
  suggestions: (page: HeidiPage, client?: string) =>
    request<{ data: HeidiSuggestion[] }>(
      `/heidi/suggestions?${new URLSearchParams(client ? { page, client } : { page })}`,
    ),
}

/** A failed Heidi answer in the reader's language, by its code; the server's words for a code this app doesn't know. */
export function heidiErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case 'heidi_provider_unavailable':
      return translate('heidiErrorUnavailable')
    case 'heidi_busy':
      return translate('heidiErrorBusy')
    case 'heidi_ai_misconfigured':
      return translate('heidiErrorMisconfigured')
    case 'heidi_usage_uncertain':
      return translate('heidiErrorUsageUncertain')
    case 'heidi_paused':
      return translate('heidiErrorPaused')
    default:
      return message
  }
}
