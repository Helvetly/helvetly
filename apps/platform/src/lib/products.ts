'use client'

// Products & services, typed by hand from docs/products-contract.md.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import type { ApiError } from '@/lib/api'
import { request } from '@/lib/api'
import type { Page } from '@/lib/clients'
import type { Decimal, LineInput, Unit, VatCategory, VatMode } from '@/lib/invoices'

export type ProductType = 'product' | 'service'
export type PriceBasis = 'net' | 'gross'

export type Product = {
  id: string
  type: ProductType
  name: string
  description: string | null
  sku: string | null
  gtin: string | null
  unit: Unit | null
  price_basis: PriceBasis
  unit_price: Decimal
  unit_price_net: Decimal
  unit_price_gross: Decimal
  currency: string
  vat_category: VatCategory
  vat_rate: Decimal
  is_archived: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type ProductInput = Pick<
  Product,
  | 'type'
  | 'name'
  | 'description'
  | 'sku'
  | 'gtin'
  | 'unit'
  | 'price_basis'
  | 'unit_price'
  | 'currency'
  | 'vat_category'
  | 'vat_rate'
>

export type BulkAction = 'archive' | 'unarchive' | 'delete'
export type BulkResult = { updated: number; skipped: { id: string; reason: string }[] }

export const SORT_FIELDS = ['name', 'sku', 'unit_price', 'created_at', 'updated_at'] as const
export type SortField = (typeof SORT_FIELDS)[number]
export type ProductStatus = 'active' | 'archived'

/** Everything that decides which items the list shows, as in the URL. */
export type ListParams = {
  page: number
  /** Rows per page, a choice kept in this browser (not in the URL). */
  pageSize?: number
  search: string
  type: ProductType | null
  status: ProductStatus
  currencies: string[]
  sort: SortField
  desc: boolean
}

export const PAGE_SIZE = 50
export const DEFAULT_PARAMS: ListParams = {
  page: 1,
  search: '',
  type: null,
  status: 'active',
  currencies: [],
  sort: 'name',
  desc: false,
}

const isSortField = (value: string): value is SortField =>
  (SORT_FIELDS as readonly string[]).includes(value)

/** The list's state from the page URL. Anything unknown or malformed falls back to the default. */
export function parseListParams(query: URLSearchParams): ListParams {
  const page = Number(query.get('page'))
  const type = query.get('type')
  const field = (query.get('sort') ?? '').replace(/^-/, '')
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    search: query.get('q') ?? '',
    type: type === 'product' || type === 'service' ? type : null,
    status: query.get('status') === 'archived' ? 'archived' : 'active',
    currencies: [
      ...new Set(
        query
          .getAll('currency')
          .map((code) => code.toUpperCase())
          .filter((code) => /^[A-Z]{3}$/.test(code)),
      ),
    ],
    sort: isSortField(field) ? field : DEFAULT_PARAMS.sort,
    desc: isSortField(field) ? (query.get('sort') ?? '').startsWith('-') : DEFAULT_PARAMS.desc,
  }
}

/** The list's state as URL query, leaving out defaults so links stay short. Keeps other keys. */
export function listParamsToQuery(params: ListParams, base = new URLSearchParams()) {
  const query = new URLSearchParams(base)
  for (const key of ['page', 'q', 'type', 'status', 'currency', 'sort']) query.delete(key)
  if (params.page > 1) query.set('page', String(params.page))
  if (params.search) query.set('q', params.search)
  if (params.type) query.set('type', params.type)
  if (params.status !== 'active') query.set('status', params.status)
  for (const code of params.currencies) query.append('currency', code)
  if (params.sort !== DEFAULT_PARAMS.sort || params.desc !== DEFAULT_PARAMS.desc)
    query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

/** The API's list query for `params` (the export takes the same filters, without paging). */
export function apiQuery(params: ListParams, paging = true) {
  const query = new URLSearchParams()
  if (paging) {
    query.set('page', String(params.page))
    query.set('page_size', String(params.pageSize ?? PAGE_SIZE))
  }
  const search = params.search.trim()
  if (search) query.set('search', search)
  if (params.type) query.set('type', params.type)
  query.set('status', params.status)
  for (const code of params.currencies) query.append('currency', code)
  query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

const path = (id: string) => `/products/${encodeURIComponent(id)}`

export const productsApi = {
  list: (params: ListParams) => request<Page<Product>>(`/products?${apiQuery(params)}`),
  search: (term: string, currency?: string) =>
    request<{ data: Product[] }>(
      `/products/search?${new URLSearchParams({ q: term, limit: '10', ...(currency ? { currency } : {}) })}`,
    ),
  get: (id: string) => request<{ data: Product }>(path(id)),
  create: (input: Partial<ProductInput>) =>
    request<{ data: Product }>('/products', { method: 'POST', json: input }),
  update: (id: string, input: Partial<ProductInput>) =>
    request<{ data: Product }>(path(id), { method: 'PATCH', json: input }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  archive: (id: string, archived: boolean) =>
    request<{ data: Product }>(`${path(id)}/${archived ? 'archive' : 'unarchive'}`, {
      method: 'POST',
    }),
  duplicate: (id: string) =>
    request<{ data: Product }>(`${path(id)}/duplicate`, { method: 'POST' }),
  bulk: (ids: string[], action: BulkAction) =>
    request<{ data: BulkResult }>('/products/bulk', { method: 'POST', json: { ids, action } }),
}

// Downloads go through plain links so the browser sends the session cookie and saves the file.
export const exportUrl = (params: ListParams) =>
  `/api/v1/products/export?${apiQuery(params, false)}`
export const exportIdsUrl = (ids: string[]) =>
  `/api/v1/products/export?${new URLSearchParams({ ids: ids.join(',') })}`

export const productKeys = {
  all: ['products'] as const,
  list: (params: ListParams) => ['products', 'list', params] as const,
  detail: (id: string) => ['products', id] as const,
  search: (term: string, currency: string) => ['products', 'search', term, currency] as const,
}

export const productListQuery = (params: ListParams) => ({
  queryKey: productKeys.list(params),
  queryFn: () => productsApi.list(params),
})

export function useProductList(params: ListParams) {
  return useQuery({ ...productListQuery(params), placeholderData: keepPreviousData })
}

export const productQuery = (id: string) => ({
  queryKey: productKeys.detail(id),
  queryFn: async () => (await productsApi.get(id)).data,
})

export function useProduct(id: string | null) {
  return useQuery({ ...productQuery(id ?? ''), enabled: id !== null })
}

/** Active items for a picker, ranked by the server for typing. */
export function useProductSearch(term: string, currency: string, enabled = true) {
  const trimmed = term.trim()
  return useQuery({
    queryKey: productKeys.search(trimmed, currency),
    queryFn: async () => (await productsApi.search(trimmed, currency)).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** After a write: this item's cache, and the lists and searches (they may sort or filter by it). */
function refresh(queryClient: QueryClient, product?: Product) {
  if (product) queryClient.setQueryData(productKeys.detail(product.id), product)
  void queryClient.invalidateQueries({ queryKey: ['products', 'list'] })
  void queryClient.invalidateQueries({ queryKey: ['products', 'search'] })
}

export function useSaveProduct() {
  const queryClient = useQueryClient()
  return useMutation<Product, ApiError, { id?: string; input: Partial<ProductInput> }>({
    mutationFn: async ({ id, input }) =>
      (id ? await productsApi.update(id, input) : await productsApi.create(input)).data,
    onSuccess: (product) => refresh(queryClient, product),
  })
}

export function useArchiveProduct() {
  const queryClient = useQueryClient()
  return useMutation<Product, ApiError, { id: string; archived: boolean }>({
    mutationFn: async ({ id, archived }) => (await productsApi.archive(id, archived)).data,
    onSuccess: (product) => refresh(queryClient, product),
  })
}

export function useDuplicateProduct() {
  const queryClient = useQueryClient()
  return useMutation<Product, ApiError, string>({
    mutationFn: async (id) => (await productsApi.duplicate(id)).data,
    onSuccess: (product) => refresh(queryClient, product),
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: productsApi.remove,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: productKeys.detail(id) })
      refresh(queryClient)
    },
  })
}

export function useBulkProducts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: BulkAction }) =>
      (await productsApi.bulk(ids, action)).data,
    onSuccess: (_, { ids }) => {
      for (const id of ids) void queryClient.invalidateQueries({ queryKey: productKeys.detail(id) })
      refresh(queryClient)
    },
  })
}

/** Who may archive and delete items (members can read, create, edit and duplicate). */
export const canManageProducts = (role: string | undefined) => role === 'owner' || role === 'admin'

/** An invoice line's fields from a catalogue item: docs/products-contract.md, "Using it on an invoice". */
export type PickedLine = Pick<
  LineInput,
  'description' | 'quantity' | 'unit' | 'unit_price' | 'vat_category' | 'vat_rate'
>

export function lineFromProduct(product: Product, vatMode: VatMode): PickedLine {
  // One line that wraps only when it must: a line break would always print the description on its own row.
  const description = product.description
    ? `${product.name} – ${product.description}`
    : product.name
  if (vatMode === 'none')
    return {
      description,
      quantity: '1',
      unit: product.unit,
      unit_price: product.unit_price_net,
      vat_category: 'O',
      vat_rate: '0',
    }
  return {
    description,
    quantity: '1',
    unit: product.unit,
    unit_price: vatMode === 'inclusive' ? product.unit_price_gross : product.unit_price_net,
    vat_category: product.vat_category,
    vat_rate: product.vat_rate,
  }
}
