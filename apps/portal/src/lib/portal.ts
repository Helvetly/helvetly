// Client portal, typed by hand from docs/portal-contract.md. Every call is `public`: a 401 here
// is the portal's own sign-in, never the staff redirect.
import { ApiError, request, setCsrfToken, type EmailCodeSent } from '@helvetly/ui/lib/http'

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

export type PortalDocument = {
  id: string
  name: string
  size: number
  content_type: string
  shared_at: string
}

export type ProfileFields = {
  name: string
  billing_email: string | null
  phone: string | null
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
  profile: ProfileFields
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
  documents: ['portal', 'documents'] as const,
  profile: ['portal', 'profile'] as const,
}

export const startPortalSignIn = (email: string) =>
  call<EmailCodeSent>('/auth/start', { method: 'POST', json: { email } })

export async function verifyPortalCode(email: string, code: string) {
  const result = await call<{ csrf_token: string }>('/auth/verify', {
    method: 'POST',
    json: { email, code },
  })
  setCsrfToken(result.csrf_token)
  return result
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
  `/api/v1${base}/invoices/${id(invoiceId)}/pdf`
export const listPortalEngagements = async () =>
  (await call<{ data: PortalEngagement[] }>('/engagements')).data
export const listPortalDocuments = async () =>
  (await call<{ data: PortalDocument[] }>('/documents')).data
export const portalDocumentUrl = (documentId: string) =>
  `/api/v1${base}/documents/${id(documentId)}/download`
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
