'use client'
// Documents, typed by hand from docs/documents-contract.md.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { ApiError, errorFromBody, getCsrfToken, request } from '@/lib/api'
import type { Client } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { isoDay, sinceDate, type SincePreset } from '@/lib/list-query'
import type { Sort, SortValue } from '@/lib/list-sort'
import { queryKeys } from '@/lib/queries'
import { folderLabel } from '@/lib/system-folders'
import { MAX_FILE_BYTES } from '@/lib/upload-packs'

export type Person = { id: string; name: string; avatar_url?: string | null }

export type SystemKind =
  | 'clients'
  | 'expenses'
  | 'client'
  | 'invoices'
  | 'quotes'
  | 'engagements'
  | 'signatures'
  | 'documents'
  | 'expense_category'
  | 'contracts'
  | 'year'

/** A folder named inside a file, filing or Trash row. */
export type FolderRef = { id: string; name: string; system_kind?: SystemKind | null }

export type Folder = {
  id: string
  name: string
  /** Set on the folders Helvetly manages: they cannot be renamed, moved or trashed. */
  system_kind?: SystemKind | null
  parent_id: string | null
  file_count: number
  size: number
  total_files: number
  total_size: number
  /** By the person signed in: stars are personal. */
  starred: boolean
  created_by: Person | null
  created_at: string
  updated_at: string
}

export const KINDS = [
  'pdf',
  'image',
  'spreadsheet',
  'document',
  'presentation',
  'text',
  'archive',
] as const
export type Kind = (typeof KINDS)[number] | 'other'

export type DocLink = {
  /** quote: the quote a contract was made from (label: its number); never unlinked by hand. */
  type: 'client' | 'invoice' | 'expense' | 'signature' | 'quote'
  id: string
  label: string
  retains: boolean
}

/** What AI filing did with an upload: queued, filed (`folder` is where it went), skipped or undone. */
export type AIFiling = {
  status: 'queued' | 'filed' | 'skipped' | 'undone'
  folder: FolderRef | null
  created_folder: boolean
  /** The tags filing added. */
  tags: string[]
}

export type DocFile = {
  id: string
  name: string
  folder_id: string | null
  folder: FolderRef | null
  size: number
  content_type: string
  kind: Kind
  sha256: string | null
  /** Lower-case, at most 10. */
  tags: string[]
  ai_filing: AIFiling | null
  previewable: boolean
  links: DocLink[]
  /** The clients that see it in their portal, newest first (absent from an older API). */
  shared_with?: DocumentShare[]
  retained_until: string | null
  uploaded_by: Person | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  deleted_by: Person | null
  purge_at: string | null
}

export type TrashItem = {
  type: 'file' | 'folder'
  id: string
  name: string
  content_type: string | null
  size: number
  item_count: number
  location: FolderRef | null
  retained_until: string | null
  deleted_at: string
  deleted_by: Person | null
  purge_at: string
}

/** The trash table's sortable columns; the list has always come newest-deleted first. */
export const TRASH_SORTS = ['name', 'was', 'deleted', 'size', 'purge'] as const
export type TrashSortField = (typeof TRASH_SORTS)[number]
export const DEFAULT_TRASH_SORT: Sort<TrashSortField> = { field: 'deleted', desc: true }

export function trashSortValue(
  item: Pick<TrashItem, 'name' | 'size' | 'location' | 'deleted_at' | 'purge_at'>,
  field: TrashSortField,
): SortValue {
  if (field === 'name') return item.name
  if (field === 'was') return item.location ? folderLabel(item.location) : translate('allDocuments')
  if (field === 'size') return item.size
  return field === 'deleted' ? item.deleted_at : item.purge_at
}

export type Tally = { files: number; size: number }
export type Usage = Tally & { by_kind: (Tally & { kind: Kind })[]; trash: Tally }

export type Page<T> = {
  data: T[]
  meta: { page: number; page_size: number; total: number; total_pages: number }
}

export type OnConflict = 'fail' | 'keep_both' | 'replace'
export type BulkAction = 'move' | 'trash' | 'restore' | 'delete'
export type BulkResult = { updated: number; skipped: { id: string; reason: string }[] }

export const KIND_LABELS: Record<Kind, string> = {
  pdf: 'PDF',
  image: translate('image'),
  spreadsheet: translate('spreadsheet'),
  document: translate('document'),
  presentation: translate('presentation'),
  text: translate('text'),
  archive: translate('archive'),
  other: translate('file'),
}

/** What `<input accept>` offers; the server checks the content anyway. */
export const ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.ods,.csv,.docx,.doc,.odt,.pptx,.odp,.txt,.md,.json,.xml,.zip'

// ---- the page's state, as in the URL ----

export const SORT_FIELDS = ['name', 'created_at', 'updated_at', 'size', 'kind'] as const
export type SortField = (typeof SORT_FIELDS)[number]
export type DatePreset = SincePreset
export type Section = 'files' | 'recent' | 'trash' | 'signatures' | 'templates'

// ---- virtual groups: files grouped by what they are, computed by the API; nothing moves ----

export const GROUP_DIMS = ['type', 'year', 'client'] as const
export type GroupDim = (typeof GROUP_DIMS)[number]
/** At most this many grouping levels, each dimension once (the API's rule). */
export const MAX_GROUP_LEVELS = GROUP_DIMS.length
export const DOC_TYPES = [
  'invoices',
  'quotes',
  'credit_notes',
  'receipts',
  'contracts',
  'engagements',
  'other',
] as const
export type DocType = (typeof DOC_TYPES)[number]
export const NO_CLIENT = 'none'
export type DocGroup = { key: string; label: string; count: number; size: number }
export type GroupLevel = { by: GroupDim; groups: DocGroup[] }

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoices: translate('docTypeInvoices'),
  quotes: translate('docTypeQuotes'),
  credit_notes: translate('docTypeCreditNotes'),
  receipts: translate('docTypeReceipts'),
  contracts: translate('docTypeContracts'),
  engagements: translate('docTypeEngagements'),
  other: translate('docTypeOther'),
}
export const GROUP_DIM_LABELS: Record<GroupDim, string> = {
  type: translate('groupByType'),
  year: translate('groupByYear'),
  client: translate('groupByClient'),
}

const isDocType = (value: string): value is DocType =>
  (DOC_TYPES as readonly string[]).includes(value)
const isDim = (value: string): value is GroupDim =>
  (GROUP_DIMS as readonly string[]).includes(value)

/** A grouping from its URL form ("client,year"): the known dimensions in their order, each once. */
export function parseGrouping(raw: string | null): GroupDim[] {
  return [...new Set((raw ?? '').split(',').filter(isDim))]
}

const GROUPING_KEY = 'helvetly.documents.group'
/** The person's last Group by choice on this device ("" = Folders); storage may be off. */
export function storedGrouping(): GroupDim[] {
  try {
    return parseGrouping(localStorage.getItem(GROUPING_KEY))
  } catch {
    return []
  }
}
export function storeGrouping(dims: readonly GroupDim[]) {
  try {
    localStorage.setItem(GROUPING_KEY, dims.join())
  } catch {
    // private mode or storage full: the URL still holds it
  }
}

/** The view's group value of one dimension, null while that level is still open. */
export function groupValue(view: ViewParams, dim: GroupDim): string | null {
  if (dim === 'type') return view.type
  if (dim === 'year') return view.year === null ? null : String(view.year)
  return view.client
}

/** The change that sets one dimension's value (null clears it). */
export function groupChange(dim: GroupDim, value: string | null): Partial<ViewParams> {
  if (dim === 'type') return { type: value && isDocType(value) ? value : null }
  if (dim === 'year') return { year: value ? Number(value) : null }
  return { client: value }
}

/** The first grouping level the view has not chosen a group of, or null at the files of one group. */
export const openDim = (view: ViewParams) =>
  view.group.find((dim) => groupValue(view, dim) === null) ?? null

/** A group's name: a type's, a year, a client's (or "No client"). */
export function groupLabel(dim: GroupDim, group: Pick<DocGroup, 'key' | 'label'>) {
  if (dim === 'type') return isDocType(group.key) ? DOC_TYPE_LABELS[group.key] : group.key
  if (dim === 'client')
    return group.key === NO_CLIENT
      ? translate('noClient')
      : group.label || translate('deletedClient')
  return group.key
}

/** The filters every list, group and ZIP of the view shares (not the folder: groups look everywhere). */
function filterQuery(view: ViewParams, userId: string | undefined, query: URLSearchParams) {
  if (view.search.trim()) query.set('search', view.search.trim())
  for (const kind of view.kinds) query.append('kind', kind)
  if (view.mine && userId) query.set('uploaded_by', userId)
  if (view.date) query.set('from', presetFrom(view.date))
  if (view.type) query.set('type', view.type)
  if (view.year !== null) query.set('year', String(view.year))
  if (view.client) query.set('client', view.client)
  return query
}

/** The query of a grouped view's open level (or the counts of a grouping, for the sidebar's Views). */
export function groupsQuery(view: ViewParams, userId: string | undefined) {
  return filterQuery(view, userId, new URLSearchParams({ group: view.group.join() }))
}

/** What the view shows, as the ZIP's query: its list's filters (its folder too, outside a grouping) and grouping. */
export function zipQuery(view: ViewParams, userId: string | undefined) {
  const query = listQuery(view, userId)
  query.delete('page_size')
  query.delete('sort')
  if (view.group.length > 0) query.set('group', view.group.join())
  return query
}

/** The download of what the view shows, as one ZIP (streamed: up to the API's limit for it). */
export const zipUrl = (view: ViewParams, userId: string | undefined) =>
  `/api/v1/documents/groups/zip?${zipQuery(view, userId)}`

/** A ZIP too big to stream, built in the background and announced in the bell. */
export type ZipExport = {
  id: string
  name: string
  status: 'pending' | 'ready' | 'failed'
  files: number
  bytes: number
  created_at: string
  expires_at: string | null
}
export const zipExportUrl = (id: string) =>
  `/api/v1/documents/exports/${encodeURIComponent(id)}/download`

export type ViewParams = {
  section: Section
  folder: string | null // null = top level
  search: string
  /** Group by (empty = Folders) and the groups chosen so far, which also filter as the search's chips. */
  group: GroupDim[]
  type: DocType | null
  year: number | null
  client: string | null
  kinds: Kind[]
  mine: boolean
  date: DatePreset | null
  sort: SortField
  desc: boolean
  layout: 'grid' | 'list'
  file: string | null // the open preview
  request: string | null // the open signature request
}

export const DEFAULT_VIEW: ViewParams = {
  section: 'files',
  folder: null,
  search: '',
  group: [],
  type: null,
  year: null,
  client: null,
  kinds: [],
  mine: false,
  date: null,
  sort: 'name',
  desc: false,
  layout: 'grid',
  file: null,
  request: null,
}

const isSort = (value: string): value is SortField =>
  (SORT_FIELDS as readonly string[]).includes(value)
const isKind = (value: string): value is Kind => (KINDS as readonly string[]).includes(value)

export function parseView(query: URLSearchParams): ViewParams {
  const section = query.get('view')
  const sort = (query.get('sort') ?? '').replace(/^-/, '')
  const date = query.get('date')
  const type = query.get('type') ?? ''
  return {
    section:
      section === 'recent' ||
      section === 'trash' ||
      section === 'signatures' ||
      section === 'templates'
        ? section
        : 'files',
    folder: query.get('folder') || null,
    search: query.get('q') ?? '',
    group: parseGrouping(query.get('group')),
    type: isDocType(type) ? type : null,
    year: /^\d{4}$/.test(query.get('year') ?? '') ? Number(query.get('year')) : null,
    client: query.get('client') || null,
    kinds: [...new Set(query.getAll('kind').filter(isKind))],
    mine: query.get('mine') === '1',
    date: date === '7d' || date === '30d' || date === 'year' ? date : null,
    sort: isSort(sort) ? sort : DEFAULT_VIEW.sort,
    desc: isSort(sort) ? (query.get('sort') ?? '').startsWith('-') : DEFAULT_VIEW.desc,
    layout: query.get('layout') === 'list' ? 'list' : 'grid',
    file: query.get('file') || null,
    request: query.get('request') || null,
  }
}

export function viewToQuery(view: ViewParams) {
  const query = new URLSearchParams()
  if (view.section !== 'files') query.set('view', view.section)
  if (view.folder && view.section === 'files') query.set('folder', view.folder)
  if (view.search) query.set('q', view.search)
  if (view.group.length > 0 && view.section === 'files') query.set('group', view.group.join())
  if (view.type) query.set('type', view.type)
  if (view.year !== null) query.set('year', String(view.year))
  if (view.client) query.set('client', view.client)
  for (const kind of view.kinds) query.append('kind', kind)
  if (view.mine) query.set('mine', '1')
  if (view.date) query.set('date', view.date)
  if (view.sort !== DEFAULT_VIEW.sort || view.desc !== DEFAULT_VIEW.desc)
    query.set('sort', `${view.desc ? '-' : ''}${view.sort}`)
  if (view.layout !== 'grid') query.set('layout', view.layout)
  if (view.file) query.set('file', view.file)
  if (view.request) query.set('request', view.request)
  return query
}

export const presetFrom = sinceDate

/** The list query for a view. Search and "Recent" look in every folder. */
export function listQuery(view: ViewParams, userId: string | undefined) {
  const query = filterQuery(view, userId, new URLSearchParams({ page_size: '500' }))
  const everywhere =
    view.section === 'recent' ||
    view.search.trim().length > 0 ||
    view.group.length > 0 ||
    view.type !== null ||
    view.year !== null ||
    view.client !== null
  if (!everywhere) query.set('folder_id', view.folder ?? 'root')
  query.set(
    'sort',
    view.section === 'recent' ? '-created_at' : `${view.desc ? '-' : ''}${view.sort}`,
  )
  return query
}

// ---- the folder tree ----

/** Folders by parent ("" = top level), each list in name order as the API sends them. */
export function childrenOf(folders: Folder[]) {
  const map = new Map<string, Folder[]>()
  for (const folder of folders) {
    const key = folder.parent_id ?? ''
    map.set(key, [...(map.get(key) ?? []), folder])
  }
  return map
}

/** The folder and its ancestors, top level first (for breadcrumbs); empty for the top level. */
export function pathTo(folders: Folder[], id: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const path: Folder[] = []
  for (let current = id ? byId.get(id) : undefined; current;) {
    if (path.includes(current)) break
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}

/** `id` is `ancestor` or somewhere below it. */
export function isWithin(folders: Folder[], id: string | null, ancestor: string) {
  return pathTo(folders, id).some((folder) => folder.id === ancestor)
}

/** "Offer (2).pdf" when "Offer.pdf" is taken, as the server names a "keep both" (case-insensitive). */
export function freeName(name: string, taken: string[], keepExtension = true) {
  const used = new Set(taken.map((entry) => entry.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  const dot = keepExtension ? name.lastIndexOf('.') : -1
  const ext = dot > 0 ? name.slice(dot) : ''
  const base = (ext ? name.slice(0, -ext.length) : name).replace(/ \(\d+\)$/, '')
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

export { formatSize } from '@helvetly/ui/lib/format'

/** Whole days until `iso` (0 when today or past), for the Trash's countdown. */
export function daysLeft(iso: string, now = Date.now()) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000))
}

/** The file is a business record today (it can't be trashed or deleted). */
export const isRetained = (until: string | null, today = isoDay(new Date())) =>
  until !== null && until >= today

/** Where a backlink opens. */
/** A link as shown: a contract's quote reads "Created from quote 2026/Q/001". */
export const linkLabel = (link: DocLink) =>
  link.type === 'quote'
    ? translate('createdFromQuote', { number: link.label || translate('draft') })
    : link.label

export function linkHref(link: DocLink) {
  if (link.type === 'signature')
    return `/documents?${new URLSearchParams({ view: 'signatures', request: link.id })}`
  const page = { client: '/clients', invoice: '/invoices', expense: '/expenses', quote: '/quotes' }[
    link.type
  ]
  return `${page}?${new URLSearchParams({ id: link.id })}`
}

// ---- the API ----

const path = (id: string) => `/documents/${encodeURIComponent(id)}`

export const docsApi = {
  folders: () => request<{ data: Folder[] }>('/documents/folders'),
  createFolder: (name: string, parentId: string | null) =>
    request<{ data: Folder }>('/documents/folders', {
      method: 'POST',
      json: { name, parent_id: parentId },
    }),
  updateFolder: (id: string, change: { name?: string; parent_id?: string | null }) =>
    request<{ data: Folder }>(`/documents/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: change,
    }),
  star: (id: string, on: boolean) =>
    request<void>(`/documents/folders/${encodeURIComponent(id)}/star`, {
      method: on ? 'PUT' : 'DELETE',
    }),
  list: (query: URLSearchParams) => request<Page<DocFile>>(`/documents?${query}`),
  groups: (query: URLSearchParams) => request<{ data: GroupLevel }>(`/documents/groups?${query}`),
  /** Whether the ZIP can be made: null to stream it, async when it is built in the background, or the API's
   * refusal (too big, empty). */
  checkZip: (query: URLSearchParams) => {
    const check = new URLSearchParams(query)
    check.set('check', '1')
    return request<{ data: { async: boolean; files: number; bytes: number } } | null>(
      `/documents/groups/zip?${check}`,
    )
  },
  /** Queues the ZIP to be built in the background. */
  queueZip: (query: URLSearchParams) =>
    request<{ data: ZipExport }>(`/documents/groups/zip?${query}`, { method: 'POST' }),
  /** The person's own ZIPs: pending, ready, recently failed. */
  zipExports: () => request<{ data: ZipExport[] }>('/documents/exports'),
  get: (id: string) => request<{ data: DocFile }>(path(id)),
  update: (
    id: string,
    change: {
      name?: string
      folder_id?: string | null
      on_conflict?: OnConflict
      tags?: string[]
    },
  ) => request<{ data: DocFile }>(path(id), { method: 'PATCH', json: change }),
  /** Puts an AI-filed file back where it was uploaded and removes the tags filing added. */
  undoFiling: (id: string) =>
    request<{ data: DocFile }>(`${path(id)}/filing`, { method: 'DELETE' }),
  copy: (id: string, folderId: string | null) =>
    request<{ data: DocFile }>(`${path(id)}/copy`, {
      method: 'POST',
      json: { folder_id: folderId },
    }),
  link: (id: string, type: DocLink['type'], targetId: string) =>
    request<{ data: DocFile }>(`${path(id)}/links`, {
      method: 'POST',
      json: { type, id: targetId },
    }),
  unlink: (id: string, type: DocLink['type'], targetId: string) =>
    request<{ data: DocFile }>(`${path(id)}/links/${type}/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
    }),
  bulk: (body: {
    action: BulkAction
    document_ids?: string[]
    folder_ids?: string[]
    folder_id?: string | null
    on_conflict?: OnConflict
  }) => request<{ data: BulkResult }>('/documents/bulk', { method: 'POST', json: body }),
  trash: () => request<{ data: TrashItem[] }>('/documents/trash'),
  usage: () => request<{ data: Usage }>('/documents/usage'),
  emptyTrash: () =>
    request<{ data: { updated: number } }>('/documents/trash/empty', { method: 'POST' }),
  /** Asks the AI where the workspace's documents (or one folder's subtree) belong; nothing changes yet. */
  organize: (folderId?: string) =>
    request<{ data: { proposals: OrganizeProposal[]; considered: number } }>(
      '/documents/organize',
      {
        method: 'POST',
        json: folderId ? { folder_id: folderId } : {},
      },
    ),
  /** Moves and tags the approved documents, making missing folders; keep the undo to reverse it. */
  organizeApply: (items: OrganizeItem[]) =>
    request<{ data: { moved: number; tagged: number; undo: OrganizeUndo } }>(
      '/documents/organize/apply',
      { method: 'POST', json: { items } },
    ),
  organizeUndo: (undo: OrganizeUndo) =>
    request<{ data: { restored: number; deleted_folders: number } }>('/documents/organize/undo', {
      method: 'POST',
      json: undo,
    }),
}

/** One AI organize row; folder paths are "Parent/Child", "" the top level. */
export type OrganizeProposal = {
  document_id: string
  name: string
  from_folder: string | null
  folder: string
  tags: string[]
  reason: string
  change: boolean
}
export type OrganizeItem = Pick<OrganizeProposal, 'document_id' | 'folder' | 'tags'>
export type OrganizeUndo = {
  previous: { document_id: string; folder_id: string | null; tags: string[] }[]
  created_folders: string[]
}

/** The tags in use on the files in view, most used first, for suggestions. */
export function tagCounts(files: DocFile[]) {
  const counts = new Map<string, number>()
  for (const file of files) for (const tag of file.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * What a batch of AI filings did, for one toast: the files filed, and the one folder they all went to
 * (null when several, or when filing only tagged them).
 */
export function filingSummary(files: DocFile[]) {
  const filed = files.filter((file) => file.ai_filing?.status === 'filed')
  const folders = new Set(
    filed.flatMap((file) => (file.ai_filing?.folder ? folderLabel(file.ai_filing.folder) : [])),
  )
  const moved = filed.filter((file) => file.ai_filing?.folder)
  return {
    filed,
    moved: moved.length,
    folders: folders.size,
    folder: folders.size === 1 ? [...folders][0] : null,
  }
}

/** Same-origin links, so the browser sends the session cookie. */
export const contentUrl = (id: string) => `/api/v1${path(id)}/content`
export const downloadUrl = (id: string) => `/api/v1${path(id)}/download`

export const docKeys = {
  all: queryKeys.documents,
  folders: [...queryKeys.documents, 'folders'] as const,
  list: (query: string) => [...queryKeys.documents, 'list', query] as const,
  groups: (query: string) => [...queryKeys.documents, 'groups', query] as const,
  detail: (id: string) => [...queryKeys.documents, 'file', id] as const,
  trash: [...queryKeys.documents, 'trash'] as const,
  usage: [...queryKeys.documents, 'usage'] as const,
  zipExports: [...queryKeys.documents, 'zip-exports'] as const,
}

export const foldersQuery = {
  queryKey: docKeys.folders,
  queryFn: async () => (await docsApi.folders()).data,
}

export const docListQuery = (query: URLSearchParams) => {
  const text = query.toString()
  return { queryKey: docKeys.list(text), queryFn: () => docsApi.list(new URLSearchParams(text)) }
}

export function useFolders() {
  return useQuery(foldersQuery)
}

export function useDocList(query: URLSearchParams, enabled = true) {
  return useQuery({ ...docListQuery(query), placeholderData: keepPreviousData, enabled })
}

/** One level of a grouped view: the groups and their counts. */
export function useDocGroups(query: URLSearchParams, enabled = true) {
  const text = query.toString()
  return useQuery({
    queryKey: docKeys.groups(text),
    queryFn: async () => (await docsApi.groups(new URLSearchParams(text))).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** The person's ZIPs; asked again every few seconds while one is being prepared. */
export function useZipExports(enabled = true) {
  return useQuery({
    queryKey: docKeys.zipExports,
    queryFn: async () => (await docsApi.zipExports()).data,
    refetchInterval: (query) =>
      query.state.data?.some((zip) => zip.status === 'pending') ? 5000 : false,
    enabled,
  })
}

export const docQuery = (id: string) => ({
  queryKey: docKeys.detail(id),
  queryFn: async () => (await docsApi.get(id)).data,
})

export function useDoc(id: string | null) {
  return useQuery({ ...docQuery(id ?? ''), enabled: id !== null })
}

export function useTrash(enabled = true) {
  return useQuery({
    queryKey: docKeys.trash,
    queryFn: async () => (await docsApi.trash()).data,
    enabled,
  })
}

export function useUsage(enabled = true) {
  return useQuery({
    queryKey: docKeys.usage,
    queryFn: async () => (await docsApi.usage()).data,
    enabled,
  })
}

/** The folders with one folder's star set, as the server will have it. */
export const withStar = (folders: Folder[], id: string, starred: boolean) =>
  folders.map((folder) => (folder.id === id ? { ...folder, starred } : folder))

/** Stars or unstars a folder at once; puts the star back and reports when the server refuses. */
export function useStarFolder(onError: (error: unknown) => void) {
  const queryClient = useQueryClient()
  const set = (id: string, starred: boolean) =>
    queryClient.setQueryData<Folder[]>(docKeys.folders, (folders) =>
      folders ? withStar(folders, id, starred) : folders,
    )
  return (folder: Folder) => {
    const starred = !folder.starred
    set(folder.id, starred)
    docsApi.star(folder.id, starred).catch((error: unknown) => {
      set(folder.id, !starred)
      onError(error)
    })
  }
}

/** After any write: everything under documents (folders' counts, lists, the Trash, usage) and client files. */
export function refreshDocuments(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: docKeys.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
}

/** A write whose result refreshes the documents caches. */
export function useDocMutation<Input, Output>(fn: (input: Input) => Promise<Output>) {
  const queryClient = useQueryClient()
  return useMutation<Output, ApiError, Input>({
    mutationFn: fn,
    onSuccess: () => refreshDocuments(queryClient),
  })
}

/** Who may delete forever and empty the Trash (members can do everything else). */
export const canDeleteForever = (role: string | undefined) => role === 'owner' || role === 'admin'

/** The largest document, as the API enforces it (DOCUMENTS_MAX_UPLOAD_MB may set it lower). */
export const DOCUMENT_MAX_BYTES = MAX_FILE_BYTES

/**
 * Uploads one file with progress (0–1); `signal` cancels it. Rejects with the server's error
 * (ApiError, e.g. 409 name_taken with `details.suggestion`) or an AbortError.
 */
export function uploadDocument(
  file: File,
  options: { folderId: string | null; onConflict?: OnConflict; clientId?: string },
  onProgress: (share: number) => void,
  signal?: AbortSignal,
): Promise<DocFile & { reused: boolean }> {
  // A proxy would refuse a bigger request with its own page, so the API's message is given here.
  if (file.size > DOCUMENT_MAX_BYTES)
    return Promise.reject(
      new ApiError(413, 'payload_too_large', translate('uploadFilesOfUpTo25MB')),
    )
  const form = new FormData()
  form.append('file', file)
  if (options.folderId) form.append('folder_id', options.folderId)
  if (options.onConflict) form.append('on_conflict', options.onConflict)
  if (options.clientId) form.append('client_id', options.clientId)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/documents')
    xhr.setRequestHeader(translate('accept'), 'application/json')
    const token = getCsrfToken()
    if (token) xhr.setRequestHeader('X-CSRF-Token', token)
    xhr.responseType = 'json'
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      const body: unknown = xhr.response
      // 200 + reused: the bytes were already in Documents, so the existing file answers.
      if ((xhr.status === 201 || xhr.status === 200) && isFileBody(body))
        resolve({ ...body.data, reused: xhr.status === 200 && hasReused(body) })
      else reject(errorFromBody(xhr.status, body))
    })
    xhr.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', translate('cannotReachHelvetlyCheckYourConnection'))),
    )
    xhr.addEventListener('abort', () =>
      reject(new DOMException(translate('uploadCancelled'), 'AbortError')),
    )
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

const hasReused = (body: object) => 'reused' in body && body.reused === true

function isFileBody(body: unknown): body is { data: DocFile } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    typeof body.data === 'object' &&
    body.data !== null &&
    'id' in body.data
  )
}

// ---- sharing with a client's portal (docs/portal-contract.md) ----

export type DocumentShare = { client_id: string; client_name: string; shared_at: string }

export const listShares = async (id: string) =>
  (await request<{ data: DocumentShare[] }>(`${path(id)}/shares`)).data
export const shareDocument = (id: string, clientId: string) =>
  request<void>(`${path(id)}/shares`, { method: 'POST', json: { client_id: clientId } })
export const unshareDocument = (id: string, clientId: string) =>
  request<void>(`${path(id)}/shares?client_id=${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
  })

export const shareKeys = (id: string) => [...queryKeys.documents, 'shares', id] as const

export function useShares(id: string) {
  return useQuery({ queryKey: shareKeys(id), queryFn: () => listShares(id) })
}

/** Active clients for the share picker (the portal is per client; 200 covers a normal book). */
export function useShareClients() {
  return useQuery({
    queryKey: [...queryKeys.clients, 'share-picker'],
    queryFn: async () =>
      (await request<{ data: Client[] }>('/clients?page_size=200&status=active&sort=name')).data,
  })
}

/** Share or unshare, then refetch this document's shares. */
export function useShareMutation(id: string, fn: (clientId: string) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: fn,
    // The file's `shared_with` (cards, preview) changes with it.
    onSuccess: () => {
      refreshDocuments(queryClient)
      return queryClient.invalidateQueries({ queryKey: shareKeys(id) })
    },
  })
}
