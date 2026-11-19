// Client portal, typed by hand from docs/portal-contract.md. Every call is `public`: a 401 here
// is the portal's own sign-in, never the staff redirect.
import { ApiError, apiUrl, request, setCsrfToken, type EmailCodeSent } from '@helvetly/ui/lib/http'

export type PortalSession = {
  /** The client's address this session signed in with. */
  email: string
  /** The login's photo, "" when it has none. */
  avatar_url: string
  client: { id: string; name: string }
  workspace: { name: string }
  csrf_token: string
  clients: { id: string; name: string; workspace_name: string }[]
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
}

export type PortalEngagement = {
  id: string
  name: string
  unit: string
  quantity: string
  recurrence: string
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
  quotes: ['portal', 'quotes'] as const,
  engagements: ['portal', 'engagements'] as const,
  engagementHistory: (engagementId: string) => ['portal', 'engagements', engagementId] as const,
  documents: ['portal', 'documents'] as const,
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

/**
 * The workspace of a scoped page: under /w/<slug>/ or on the workspace's own domain (portal.firma.ch, no prefix);
 * null on the shared portal (the API answers 404 there).
 */
export async function getPortalScope(): Promise<PortalScope | null> {
  try {
    return await call<PortalScope>('/scope')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export const startPortalSignIn = (email: string) =>
  call<EmailCodeSent>('/auth/start', { method: 'POST', json: { email } })

/** One client an address may open, offered on the shared portal when the address has several. */
export type PortalAccount = {
  client_id: string
  client_name: string
  workspace_name: string
  /** null when the supplier has no logo. */
  logo_url: string | null
}

/**
 * A session, or on the shared portal for an address with several clients, the accounts to choose from (the
 * CSRF token is then the choice's, good only for choosePortalAccount).
 */
export async function verifyPortalCode(email: string, code: string) {
  const result = await call<{ csrf_token: string; accounts?: PortalAccount[] }>('/auth/verify', {
    method: 'POST',
    json: { email, code },
  })
  setCsrfToken(result.csrf_token)
  return result
}

/** Records the chosen account: the address of its supplier's portal to go to next, which sends the browser back here. */
export const choosePortalAccount = async (clientId: string) =>
  (await call<{ url: string }>('/auth/choose', { method: 'POST', json: { client_id: clientId } }))
    .url

/** Spends the choice on a ticket bound to the state the chosen address sent back: where to show the ticket. */
export const issuePortalTicket = async (state: string) =>
  (await call<{ url: string }>('/auth/handoff', { method: 'POST', json: { state } })).url

/** Whom a ticket signs in as, without spending it; only the browser that chose sees it. */
export type PortalTicketPeek = { email: string; client_name: string; workspace_name: string }

export const peekPortalTicket = (ticket: string) =>
  call<PortalTicketPeek>('/auth/ticket/peek', { method: 'POST', json: { ticket } })

/** Opens this scope's session with the ticket the shared portal's choice made, ending the one the browser had here. */
export async function redeemPortalTicket(ticket: string) {
  const result = await call<{ csrf_token: string }>('/auth/ticket', {
    method: 'POST',
    json: { ticket },
  })
  setCsrfToken(result.csrf_token)
}

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

export async function switchPortalClient(clientId: string) {
  const result = await call<{ csrf_token: string }>('/session/client', {
    method: 'POST',
    json: { client_id: clientId },
  })
  setCsrfToken(result.csrf_token)
}

export async function signOutPortal() {
  await call<void>('/session', { method: 'DELETE' })
  setCsrfToken('')
}

export const listPortalInvoices = async () =>
  (await call<{ data: PortalInvoice[] }>('/invoices')).data
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
