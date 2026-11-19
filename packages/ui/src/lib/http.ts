import { translate } from '@helvetly/ui/lib/i18n'
// The JSON client of the Go API (docs/*-contract.md), shared by the platform and the portal. Both apps are
// served from the same origin as the API, so relative URLs are enough and cookies are first-party.
export const API_PREFIX = '/api/v1'

// The client portal under a workspace's address (/w/<slug>) calls the API under the same prefix, so the server knows
// the scope of every call, downloads and images included; '' everywhere else.
let apiBase = ''

export function setApiBase(prefix: string) {
  apiBase = prefix
}

/** The URL of an API path, for links and images that can't go through `request`. */
export const apiUrl = (path: string) => apiBase + API_PREFIX + path

/** What POST …/email/start (staff or portal) answers: seconds until a resend, and the code's lifetime. */
export type EmailCodeSent = { resend_in: number; expires_in: number }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : translate('somethingWentWrongTryAgain')
}

// The CSRF token lives in memory only: it comes from sign-in responses and GET /session.
let csrfToken = ''
let onUnauthorized = () => {}

export function setCsrfToken(token: string) {
  csrfToken = token
}

/** For requests that can't go through `request`, e.g. uploads that report progress. */
export function getCsrfToken() {
  return csrfToken
}

/** Set by <Providers>: what a 401 from a signed-in call does (go to /login). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  json?: unknown
  /** A multipart body; the browser sets its Content-Type. */
  form?: FormData
  public?: boolean
  signal?: AbortSignal
}

async function send(
  path: string,
  { method = 'GET', json, form, signal }: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (json !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  try {
    return await fetch(apiUrl(path), {
      method,
      headers,
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
      credentials: 'same-origin',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError(0, 'network_error', translate('cannotReachHelvetlyCheckYourConnection'))
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

async function toApiError(res: Response): Promise<ApiError> {
  return errorFromBody(res.status, await res.json().catch(() => null))
}

/** The contract's `{error: {code, message, details}}` as an ApiError (anything else stays generic). */
export function errorFromBody(status: number, body: unknown): ApiError {
  const res = { status }
  const error = isRecord(body) && isRecord(body.error) ? body.error : {}
  return new ApiError(
    res.status,
    typeof error.code === 'string' ? error.code : `http_${res.status}`,
    typeof error.message === 'string'
      ? error.message
      : translate('requestFailed', { status: res.status }),
    isRecord(error.details) ? error.details : {},
  )
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await respond(path, options)
  // 204 has no body: parsed as null for the `void` endpoints.
  return JSON.parse((await res.text()) || 'null')
}

/** The successful response itself, for streams (Server-Sent Events) the caller reads. */
export async function respond(path: string, options: RequestOptions = {}): Promise<Response> {
  const res = await send(path, options)
  if (res.ok) return res

  const error = await toApiError(res)
  // A new cookie may belong to another workspace. Replaying this write could put old data there.
  if (!options.public && (error.status === 401 || error.code === 'csrf_failed')) {
    setCsrfToken('')
    onUnauthorized()
  }
  throw error
}
