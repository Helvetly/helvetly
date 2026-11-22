'use client'
// Clients, typed by hand from docs/clients-contract.md.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { type ApiError, request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { MAX_FILE_BYTES, uploadInPacks } from '@/lib/upload-packs'

export type AddressField = 'street' | 'street_number' | 'zip' | 'city' | 'country'
export type ElectronicAddress = { scheme: string; id: string }

type StreetParts = {
  street?: string | null
  street_number?: string | null
  apt?: string | null
  country?: string | null
}

/** "Street 3/3" in Poland, "Street 3, Apt 3" elsewhere: the street line as printed, the stored fields stay separate. */
export function streetLine({ street, street_number, apt, country }: StreetParts): string {
  const line = [street, street_number]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  const unit = apt?.trim()
  if (!unit) return line
  if (!line) return unit
  return country === 'PL' && street_number?.trim() ? `${line}/${unit}` : `${line}, ${unit}`
}

export type Client = {
  id: string
  number: number
  name: string
  preferred_name: string | null
  is_company: boolean
  is_active: boolean
  email: string | null
  phone: string | null
  street: string | null
  street_number: string | null
  apt: string | null
  zip: string | null
  city: string | null
  country: string | null
  internal_id: string | null
  note: string | null
  website: string | null
  vat_number: string | null
  electronic_address?: ElectronicAddress | null
  registration_number?: string | null
  /** ISO 3166-2 subdivision; for a Romanian address its county (RO e-Factura). */
  region?: string | null
  language: Language | null
  currency: string | null
  payment_terms_days: number | null
  tags: string[]
  /** false: overdue invoices get no dunning notices. */
  dunning_enabled?: boolean
  /** The XML attached to invoice emails next to the PDF (docs/delivery-contract.md). */
  einvoice_format?: EInvoiceFormat
  /** A German public body's routing ID; a new invoice's buyer reference (BT-10). */
  leitweg_id?: string | null
  /** The client signs in to the portal with its email, else its billing email (docs/portal-contract.md). */
  portal_enabled?: boolean
  /** When the portal invitation last went out; null before the first. */
  portal_invited_at?: string | null
  /** The client's first portal sign-in; null before it. */
  portal_signed_in_at?: string | null
  /** The UID under which the Swiss UID register lists the client as active (missing from an older API). */
  verified_uid?: string | null
  /** When the register last confirmed it. */
  uid_verified_at?: string | null
  contacts: Contact[]
  billing_email: string | null
  is_draft: boolean
  missing_fields: AddressField[]
  files_count: number
  /** The client has a profile change request waiting for an owner or admin (docs/portal-contract.md). */
  pending_change_request?: boolean
  created_at: string
  updated_at: string
}

/** A client's pending request to change its own details, made in the portal. */
/** Address fields are approved or discarded together, as `address`. */
export const ADDRESS_FIELDS = ['street', 'street_number', 'apt', 'zip', 'city', 'country'] as const

export type ChangeRequest = {
  id: string
  fields: Record<string, string | null>
  current: Record<string, string | null>
  contact: { id: string; name: string }
  created_at: string
}

export const LANGUAGES = ['de', 'fr', 'it', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export type Contact = {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export type ContactInput = Pick<Contact, 'name' | 'role' | 'email' | 'phone' | 'is_primary'>

export type ClientInput = Pick<
  Client,
  | 'name'
  | 'preferred_name'
  | 'is_company'
  | 'is_active'
  | 'email'
  | 'phone'
  | 'street'
  | 'street_number'
  | 'apt'
  | 'zip'
  | 'city'
  | 'country'
  | 'internal_id'
  | 'note'
  | 'website'
  | 'vat_number'
  | 'electronic_address'
  | 'registration_number'
  | 'region'
  | 'language'
  | 'currency'
  | 'payment_terms_days'
  | 'tags'
  | 'billing_email'
  | 'dunning_enabled'
  | 'einvoice_format'
  | 'leitweg_id'
  | 'portal_enabled'
>

export type ClientFile = {
  id: string
  name: string
  size: number
  content_type: string
  created_at: string
  uploaded_by: { id: string; name: string; avatar_url?: string | null } | null
}

export type Page<T> = {
  data: T[]
  meta: { page: number; page_size: number; total: number; total_pages: number }
}

export const SORT_FIELDS = ['number', 'name', 'email', 'city', 'created_at', 'updated_at'] as const
export type SortField = (typeof SORT_FIELDS)[number]
export const STATUSES = ['active', 'inactive', 'draft', 'complete'] as const
export type ClientStatus = (typeof STATUSES)[number]
export type ClientType = 'company' | 'person'

/** Everything that decides which clients the list shows, as in the URL. */
export type ListParams = {
  page: number
  /** Rows per page, a choice kept in this browser (not in the URL). */
  pageSize?: number
  search: string
  status: ClientStatus[]
  type: ClientType | null
  tags: string[]
  countries: string[]
  sort: SortField
  desc: boolean
}

export const PAGE_SIZE = 50
export const DEFAULT_PARAMS: ListParams = {
  page: 1,
  search: '',
  status: [],
  type: null,
  tags: [],
  countries: [],
  sort: 'created_at',
  desc: true,
}

const isSortField = (value: string): value is SortField =>
  (SORT_FIELDS as readonly string[]).includes(value)
const isStatus = (value: string): value is ClientStatus =>
  (STATUSES as readonly string[]).includes(value)

/** The list's state from the page URL. Anything unknown or malformed falls back to the default. */
export function parseListParams(query: URLSearchParams): ListParams {
  const page = Number(query.get('page'))
  const sort = query.get('sort') ?? ''
  const type = query.get('type')
  const field = sort.replace(/^-/, '')
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    search: query.get('q') ?? '',
    status: [...new Set(query.getAll('status').filter(isStatus))],
    type: type === 'company' || type === 'person' ? type : null,
    tags: [
      ...new Set(
        query
          .getAll('tag')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ],
    countries: [
      ...new Set(
        query
          .getAll('country')
          .map((code) => code.toUpperCase())
          .filter((code) => /^[A-Z]{2}$/.test(code)),
      ),
    ],
    sort: isSortField(field) ? field : DEFAULT_PARAMS.sort,
    desc: isSortField(field) ? sort.startsWith('-') : DEFAULT_PARAMS.desc,
  }
}

/** The list's state as URL query, leaving out defaults so links stay short. Keeps other keys. */
export function listParamsToQuery(params: ListParams, base = new URLSearchParams()) {
  const query = new URLSearchParams(base)
  for (const key of ['page', 'q', 'status', 'type', 'tag', 'country', 'sort']) query.delete(key)
  if (params.page > 1) query.set('page', String(params.page))
  if (params.search) query.set('q', params.search)
  for (const status of params.status) query.append('status', status)
  if (params.type) query.set('type', params.type)
  for (const tag of params.tags) query.append('tag', tag)
  for (const country of params.countries) query.append('country', country)
  if (params.sort !== DEFAULT_PARAMS.sort || params.desc !== DEFAULT_PARAMS.desc)
    query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

/** Server search starts at two characters, or at once for a client number ("12", "#12"). */
export function effectiveSearch(term: string) {
  const trimmed = term.trim()
  return trimmed.length >= 2 || /^#?\d+$/.test(trimmed) ? trimmed : ''
}

/** The API's list query for `params` (the API pages; export takes the same filters). */
export function apiQuery(params: ListParams, paging = true) {
  const query = new URLSearchParams()
  if (paging) {
    query.set('page', String(params.page))
    query.set('page_size', String(params.pageSize ?? PAGE_SIZE))
  }
  const search = effectiveSearch(params.search)
  if (search) query.set('search', search)
  for (const status of params.status) query.append('status', status)
  if (params.type) query.set('type', params.type)
  for (const tag of params.tags) query.append('tag', tag)
  for (const country of params.countries) query.append('country', country)
  query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

const path = (id: string) => `/clients/${encodeURIComponent(id)}`

export const clientsApi = {
  list: (params: ListParams) => request<Page<Client>>(`/clients?${apiQuery(params)}`),
  search: (term: string) =>
    request<Page<Client>>(`/clients?${new URLSearchParams({ search: term, page_size: '8' })}`),
  get: (id: string) => request<{ data: Client }>(path(id)),
  create: (input: Partial<ClientInput>) =>
    request<{ data: Client }>('/clients', { method: 'POST', json: input }),
  update: (id: string, input: Partial<ClientInput>) =>
    request<{ data: Client }>(path(id), { method: 'PATCH', json: input }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  resendPortalInvite: (id: string) =>
    request<{ data: Client }>(`${path(id)}/portal-invitation`, { method: 'POST' }),
  bulk: (ids: string[], action: 'activate' | 'deactivate' | 'delete') =>
    request<{ data: { updated: number } }>('/clients/bulk', {
      method: 'POST',
      json: { ids, action },
    }),
  tags: () => request<{ data: { name: string; count: number }[] }>('/clients/tags'),
  /** The URL a typed website really answers on (https preferred, redirects followed); 422 when unreachable. */
  checkWebsite: (website: string) =>
    request<{ data: { website: string } }>('/clients/website-check', {
      method: 'POST',
      json: { website },
    }),
  addContact: (id: string, input: Partial<ContactInput>) =>
    request<{ data: Contact }>(`${path(id)}/contacts`, { method: 'POST', json: input }),
  updateContact: (id: string, contactId: string, input: Partial<ContactInput>) =>
    request<{ data: Contact }>(`${path(id)}/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      json: input,
    }),
  deleteContact: (id: string, contactId: string) =>
    request<void>(`${path(id)}/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' }),
  changeRequest: async (id: string) =>
    (await request<{ data: ChangeRequest | null }>(`${path(id)}/change-request`)).data,
  approveChangeRequest: (id: string, fields: string[]) =>
    request<{ data: Client }>(`${path(id)}/change-request/approve`, {
      method: 'POST',
      json: { fields },
    }),
  rejectChangeRequest: (id: string, reason: string) =>
    request<void>(`${path(id)}/change-request/reject`, { method: 'POST', json: { reason } }),
  files: (id: string) => request<{ data: ClientFile[] }>(`${path(id)}/files`),
  deleteFile: (id: string, fileId: string) =>
    request<void>(`${path(id)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }),
}

// Downloads go through plain links so the browser sends the session cookie and saves the file.
export const exportUrl = (params: ListParams) => `/api/v1/clients/export?${apiQuery(params, false)}`
export const exportIdsUrl = (ids: string[]) =>
  `/api/v1/clients/export?${new URLSearchParams({ ids: ids.join(',') })}`
export const fileUrl = (id: string, fileId: string) =>
  `/api/v1${path(id)}/files/${encodeURIComponent(fileId)}`

export const clientKeys = {
  all: ['clients'] as const,
  list: (params: ListParams) => ['clients', 'list', params] as const,
  detail: (id: string) => ['clients', id] as const,
  files: (id: string) => ['clients', id, 'files'] as const,
  tags: ['clients', 'tags'] as const,
  changeRequest: (id: string) => ['clients', id, 'change-request'] as const,
}

/** Every tag in the workspace with how many clients use it, for autocomplete and filters. */
export function useClientTags(enabled = true) {
  return useQuery({
    queryKey: clientKeys.tags,
    queryFn: async () => (await clientsApi.tags()).data,
    staleTime: 60_000,
    enabled,
  })
}

/** Contacts are written through their own endpoints; the client (which embeds them) is refetched. */
export function useContactMutations(id: string) {
  const queryClient = useQueryClient()
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: clientKeys.detail(id), exact: true })
    // The list's search covers contact names and emails.
    void queryClient.invalidateQueries({ queryKey: ['clients', 'list'] })
  }
  return {
    save: useMutation<Contact, ApiError, { contactId?: string; input: Partial<ContactInput> }>({
      mutationFn: async ({ contactId, input }) =>
        (contactId
          ? await clientsApi.updateContact(id, contactId, input)
          : await clientsApi.addContact(id, input)
        ).data,
      // Also after a failure: making a contact primary is shown before the server answers.
      onSettled: onSuccess,
    }),
    remove: useMutation({
      mutationFn: (contactId: string) => clientsApi.deleteContact(id, contactId),
      onSuccess,
    }),
  }
}

/** The status quick views over the list, as `status` values in the URL. */
export const STATUS_VIEWS = [
  { value: 'all', label: translate('all'), status: [] },
  { value: 'active', label: translate('active'), status: ['active'] },
  { value: 'draft', label: translate('drafts'), status: ['draft'] },
  { value: 'inactive', label: translate('inactive'), status: ['inactive'] },
] as const satisfies readonly { value: string; label: string; status: readonly ClientStatus[] }[]
export type StatusView = (typeof STATUS_VIEWS)[number]['value']

/** The quick view `status` is, or null for a combination only Filters can make. */
export function statusView(status: ClientStatus[]): StatusView | null {
  const view = STATUS_VIEWS.find(
    (entry) =>
      entry.status.length === status.length &&
      entry.status.every((value: ClientStatus) => status.includes(value)),
  )
  return view?.value ?? null
}

/** How many clients each quick view holds under the other filters: one count-only page each. */
export function useClientStatusCounts(params: ListParams) {
  // Paging and order change no count, so they stay out of the key.
  const base: ListParams = { ...params, page: 1, status: [], sort: 'created_at', desc: true }
  return useQuery({
    queryKey: [...clientKeys.list(base), 'counts'],
    queryFn: async () => {
      const totals = await Promise.all(
        STATUS_VIEWS.map(async (view) => {
          const query = apiQuery({ ...base, status: [...view.status] }, false)
          query.set('page_size', '1')
          const page = await request<Page<Client>>(`/clients?${query}`)
          return [view.value, page.meta.total] as const
        }),
      )
      return new Map(totals)
    },
    placeholderData: keepPreviousData,
  })
}

export const clientListQuery = (params: ListParams) => ({
  queryKey: clientKeys.list(params),
  queryFn: () => clientsApi.list(params),
})

export function useClientList(params: ListParams) {
  return useQuery({ ...clientListQuery(params), placeholderData: keepPreviousData })
}

export const clientQuery = (id: string) => ({
  queryKey: clientKeys.detail(id),
  queryFn: async () => (await clientsApi.get(id)).data,
})

export function useClient(id: string | null) {
  return useQuery({ ...clientQuery(id ?? ''), enabled: id !== null })
}

export function useClientFiles(id: string) {
  return useQuery({
    queryKey: clientKeys.files(id),
    queryFn: async () => (await clientsApi.files(id)).data,
  })
}

/** Clients for a picker: searched on the server, so there is no cap on how many exist. */
export function useClientSearch(term: string, enabled = true) {
  const search = effectiveSearch(term)
  return useQuery({
    queryKey: ['clients', 'search', search],
    queryFn: () =>
      search
        ? clientsApi.search(search)
        : request<Page<Client>>('/clients?page_size=8&status=active&sort=name'),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** After a write: this client's cache, and the lists (they may sort or filter by what changed). */
function refresh(queryClient: QueryClient, client?: Client) {
  if (client) queryClient.setQueryData(clientKeys.detail(client.id), client)
  void queryClient.invalidateQueries({ queryKey: ['clients', 'list'] })
  void queryClient.invalidateQueries({ queryKey: ['clients', 'search'] })
  void queryClient.invalidateQueries({ queryKey: clientKeys.tags })
}

export function useSaveClient() {
  const queryClient = useQueryClient()
  return useMutation<Client, ApiError, { id?: string; input: Partial<ClientInput> }>({
    mutationFn: async ({ id, input }) =>
      (id ? await clientsApi.update(id, input) : await clientsApi.create(input)).data,
    onSuccess: (client) => refresh(queryClient, client),
  })
}

/** Sends the portal invitation again; the client comes back with the new `portal_invited_at`. */
export function useResendPortalInvite() {
  const queryClient = useQueryClient()
  return useMutation<Client, ApiError, string>({
    mutationFn: async (id) => (await clientsApi.resendPortalInvite(id)).data,
    onSuccess: (client) => refresh(queryClient, client),
  })
}

export function useDeleteClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clientsApi.remove,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: clientKeys.detail(id) })
      refresh(queryClient)
    },
  })
}

export function useBulkClients() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ids,
      action,
    }: {
      ids: string[]
      action: 'activate' | 'deactivate' | 'delete'
    }) => clientsApi.bulk(ids, action),
    onSuccess: (_, { ids }) => {
      for (const id of ids) void queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) })
      refresh(queryClient)
    },
  })
}

export function useDeleteClientFile(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) => clientsApi.deleteFile(id, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.files(id) })
      void queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) })
    },
  })
}

export const getChangeRequest = (clientId: string) => clientsApi.changeRequest(clientId)
/** The client's pending portal change request, or null; shared by the drawer's badge and card. */
export const useChangeRequest = (clientId: string) =>
  useQuery({
    queryKey: clientKeys.changeRequest(clientId),
    queryFn: () => getChangeRequest(clientId),
  })
/** Applies the chosen changes (field keys, `address` for the whole address); the others are discarded. */
export const approveChangeRequest = async (clientId: string, fields: string[]) =>
  (await clientsApi.approveChangeRequest(clientId, fields)).data
export const rejectChangeRequest = (clientId: string, reason: string) =>
  clientsApi.rejectChangeRequest(clientId, reason)

/** Who may delete clients (members can read, create, edit and attach files). */
export const canDeleteClients = (role: string | undefined) => role === 'owner' || role === 'admin'

/** Uploads files in packs under 95 MB with one progress (0–1); rejects with the server's error, e.g. an unsupported type. */
export function uploadClientFiles(
  id: string,
  files: File[],
  onProgress: (share: number) => void,
): Promise<ClientFile[]> {
  return uploadInPacks<ClientFile>(`/api/v1${path(id)}/files`, files, MAX_FILE_BYTES, onProgress)
}

export type EInvoiceFormat = 'none' | 'xrechnung_ubl' | 'xrechnung_cii' | 'peppol' | 'factur_x'

export const EINVOICE_FORMATS: { value: EInvoiceFormat; label: string }[] = [
  { value: 'none', label: translate('pdfOnly') },
  { value: 'xrechnung_ubl', label: translate('xrechnungUBL') },
  { value: 'xrechnung_cii', label: translate('xrechnungCII') },
  { value: 'peppol', label: translate('peppolBIS') },
  { value: 'factur_x', label: translate('facturX') },
]

/**
 * A German public body's Leitweg-ID, as the server checks it: coarse part, optional fine part and two check digits
 * (ISO/IEC 7064 MOD 97-10 over the whole ID, letters as 10–35).
 */
export function isLeitwegId(value: string): boolean {
  const id = value.trim().toUpperCase()
  if (!/^[0-9]{2,12}(-[A-Z0-9]{1,30})?-[0-9]{2}$/.test(id)) return false
  let rest = 0
  for (const c of id.replaceAll('-', '')) {
    const n = Number.parseInt(c, 36)
    rest = (rest * (n > 9 ? 100 : 10) + n) % 97
  }
  return rest === 1
}
