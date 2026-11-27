// Client portal, typed by hand from docs/portal-contract.md. Every call is `public`: a 401 here
// is the portal's own sign-in, never the staff redirect.
import {
  ApiError,
  changeSession,
  apiUrl,
  request,
  setCsrfToken,
  type EmailCodeSent,
} from '@helvetly/ui/lib/http'

export type PortalSession = {
  /** The client's address this session signed in with. */
  email: string
  /** The login's photo, "" when it has none. */
  avatar_url: string
  client: { id: string; name: string }
  workspace: { name: string }
  csrf_token: string
  /** The logins this address may switch to: the client's own, or one participant of a company client. */
  clients: {
    id: string
    name: string
    workspace_name: string
    participant_id?: string
    participant_name?: string
  }[]
  /**
   * A participant's session (a person of a company client who takes its service): they see only their own sessions,
   * the documents shared with them and, when `documents` (the company sends to its participants), the invoices
   * and signature requests addressed to them. null for the client's own session.
   */
  participant?: { id: string; name: string; documents: boolean } | null
  /** A member's read-only preview of the client's portal: who started it; null for the client's own session. */
  preview?: { started_by: string } | null
}

export type PortalInvoice = {
  id: string
  kind: string
  number: string
  status: string
  is_overdue: boolean
  issue_date: string
  due_date: string | null
  currency: string
  total: string
  amount_due: string
  amount_paid: string
  current_qr?: boolean
  has_pdf?: boolean
}

export type PortalInvoiceList = {
  data: PortalInvoice[]
  paid_in?: { year: string; totals: Record<string, string> }
}

export type PortalEngagement = {
  id: string
  name: string
  unit: string | null
  quantity: string
  recurrence: string
  /** "active", or why it is past: ended, cancelled, or a one-off that expired or is used up. */
  status: 'active' | 'ended' | 'cancelled' | 'expired' | 'used_up'
  current_period: {
    starts_on: string
    ends_on: string
    used: string
    remaining: string
    overage: string
  } | null
}

/** One period of an engagement's history with what was logged in it, newest first. */
export type PortalEngagementPeriod = {
  starts_on: string
  ends_on: string
  entries: {
    id: string
    date: string
    quantity: string
    note: string | null
    client_performance: string | null
  }[]
}

export type PortalDocument = {
  id: string
  name: string
  size: number
  content_type: string
  shared_at: string
  /** The quote revision whose PDF this is, sent to the client; null for a file shared by hand. */
  quote?: { number: string; revision: number } | null
}

/** A signature request addressed to the client, as the portal lists it (revoked ones are not). */
export type PortalSignature = {
  id: string
  title: string
  status: 'pending' | 'completed' | 'declined' | 'expired'
  sent_at: string
  completed_at: string | null
  /** Pending and the signed-in address has still to sign (with the link it was emailed). */
  awaiting_you: boolean
  /** The signed PDF, with its certificate page, once completed; null while there is none to download. */
  signed_file: { name: string; size: number } | null
}

/** What a client may ask to change (the API's clients.ProfileFields). */
export type ProfileFields = {
  name: string
  preferred_name: string | null
  billing_email: string | null
  phone: string | null
  website: string | null
  street: string | null
  street_number: string | null
  apt: string | null
  zip: string | null
  city: string | null
  country: string | null
  vat_number: string | null
  registration_number: string | null
}

export type ChangeRequest = { id: string; fields: Partial<ProfileFields>; created_at: string }
/** How the client's last request was decided; `reason` is the supplier's note on a rejection. */
export type ChangeDecision = ChangeRequest & {
  status: 'approved' | 'rejected'
  applied_fields: string[] | null
  reason: string | null
  decided_at: string | null
}
export type PortalProfile = {
  /** `email` (the sign-in address) and `is_company` are shown, never requested. */
  profile: ProfileFields & { email: string | null; is_company: boolean }
  pending: ChangeRequest | null
  last_decision: ChangeDecision | null
}

const base = '/public/portal'
const call = <T>(path: string, options: Parameters<typeof request>[1] = {}) =>
  request<T>(base + path, { ...options, public: true })
const id = encodeURIComponent

export const portalKeys = {
  all: ['portal'] as const,
  session: ['portal', 'session'] as const,
  invoices: ['portal', 'invoices'] as const,
  engagements: ['portal', 'engagements'] as const,
  engagementHistory: (engagementId: string) => ['portal', 'engagements', engagementId] as const,
  documents: ['portal', 'documents'] as const,
  signatures: ['portal', 'signatures'] as const,
  profile: ['portal', 'profile'] as const,
  scope: ['portal', 'scope'] as const,
}

/** Whose portal this address is: a workspace's own (/w/<slug>/), with its name and logo. */
export type PortalScope = {
  name: string
  slug: string
  /** null when the workspace has no logo. */
  logo_url: string | null
  /** Its canonical address. */
  url: string
}

/** The workspace turned its whole portal off: the API names nobody, the page says the portal is not available. */
export const isPortalClosed = (error: unknown) =>
  error instanceof ApiError && error.code === 'portal_closed'

/**
 * The workspace of a scoped page: under /w/<slug>/ or on the workspace's own domain (portal.firma.ch, no prefix);
 * null on the shared portal (the API answers 404 there). A portal turned off throws (`isPortalClosed`).
 */
export async function getPortalScope(): Promise<PortalScope | null> {
  try {
    return await call<PortalScope>('/scope')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && !isPortalClosed(error)) return null
    throw error
  }
}

export const startPortalSignIn = (email: string) =>
  call<EmailCodeSent>('/auth/start', { method: 'POST', json: { email } })

/**
 * A session at this workspace's own address (the shared portal signs nobody in). The browser's zone goes along:
 * the API keeps the first one as the client's, so its sessions show in its local time.
 */
export async function verifyPortalCode(email: string, code: string) {
  const result = await call<{ csrf_token: string }>('/auth/verify', {
    method: 'POST',
    json: { email, code, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  })
  changeSession(result.csrf_token)
  return result
}

/** On the shared portal: emails the address its suppliers' portal links. The answer is the same for every address. */
export const emailPortalLinks = (email: string) =>
  call<void>('/auth/links', { method: 'POST', json: { email } })

/** /session as an API of any version sends it: older ones have no `email` or `clients`. */
export type PortalSessionResponse = Omit<PortalSession, 'email' | 'avatar_url' | 'clients'> &
  Partial<Pick<PortalSession, 'email' | 'avatar_url' | 'clients'>>

/** Without a list of clients, the signed-in one is the only one (and there is nothing to switch). */
export const sessionFrom = ({
  email = '',
  avatar_url = '',
  clients,
  ...rest
}: PortalSessionResponse): PortalSession => ({
  ...rest,
  email,
  avatar_url,
  clients: clients ?? [
    { id: rest.client.id, name: rest.client.name, workspace_name: rest.workspace.name },
  ],
})

/** null when nobody is signed in to the portal. */
export async function getPortalSession(): Promise<PortalSession | null> {
  try {
    const session = sessionFrom(await call<PortalSessionResponse>('/session'))
    setCsrfToken(session.csrf_token)
    return session
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/** A login's key in the switch menu: the client, and the participant for a participant's login. */
export const loginKey = (login: { id: string; participant_id?: string }) =>
  login.participant_id ? `${login.id}:${login.participant_id}` : login.id

export async function switchPortalClient(key: string) {
  const [clientId, participantId] = key.split(':')
  const result = await call<{ csrf_token: string }>('/session/client', {
    method: 'POST',
    json: { client_id: clientId, ...(participantId ? { participant_id: participantId } : {}) },
  })
  changeSession(result.csrf_token)
}

export async function signOutPortal() {
  await call<void>('/session', { method: 'DELETE' })
  changeSession('')
}

export const listPortalInvoices = () => call<PortalInvoiceList>('/invoices')
export const portalInvoicePdfUrl = (invoiceId: string) =>
  apiUrl(`${base}/invoices/${id(invoiceId)}/pdf`)
export const listPortalEngagements = async () =>
  (await call<{ data: PortalEngagement[] }>('/engagements')).data
export const listPortalEngagementHistory = async (engagementId: string) =>
  (await call<{ data: PortalEngagementPeriod[] }>(`/engagements/${id(engagementId)}/entries`)).data
export const listPortalDocuments = async () =>
  (await call<{ data: PortalDocument[] }>('/documents')).data
export const portalDocumentUrl = (documentId: string) =>
  apiUrl(`${base}/documents/${id(documentId)}/download`)
export const listPortalSignatures = async () =>
  (await call<{ data: PortalSignature[] }>('/signatures')).data
export const portalSignatureUrl = (signatureId: string) =>
  apiUrl(`${base}/signatures/${id(signatureId)}/download`)
export const getPortalProfile = () => call<PortalProfile>('/profile')

/** A 422 throws an ApiError whose `details.fields` names each bad field. */
export const requestProfileChange = (fields: Partial<ProfileFields>) =>
  call<ChangeRequest>('/profile/requests', { method: 'POST', json: fields })

/** A 422 throws an ApiError whose message says what is wrong with the image. */
export const uploadPortalAvatar = (photo: Blob) => {
  const form = new FormData()
  form.append('file', photo, photo.type === 'image/png' ? 'photo.png' : 'photo.jpg')
  return call<{ avatar_url: string }>('/avatar', { method: 'PUT', form })
}
export const deletePortalAvatar = () => call<void>('/avatar', { method: 'DELETE' })
