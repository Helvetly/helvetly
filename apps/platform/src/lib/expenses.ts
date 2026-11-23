'use client'
// Expenses, typed by hand from docs/expenses-contract.md.
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { type ApiError, request } from '@/lib/api'
import type { ApprovalState } from '@/lib/approvals'
import type { ClientFile, Page } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import type { Decimal, PaymentMethod } from '@/lib/invoices'
import { amountParam } from '@/lib/list-query'
import { queryKeys } from '@/lib/queries'
import { MAX_FILE_BYTES, uploadInPacks } from '@/lib/upload-packs'

export type ExpenseStatus = 'draft' | 'booked' | 'void'
export type AmountMode = 'gross' | 'net'
/** single: one amount per VAT rate; itemised: one line per item, each with an optional category of its own. */
export type EntryMode = 'single' | 'itemised'
export type InputTax = 'full' | 'partial' | 'none'
export type RateSource = 'estv_monthly' | 'estv_daily' | 'bank' | 'manual'
export type MissingField =
  | 'supplier_name'
  | 'document_date'
  | 'category'
  | 'total'
  | 'items'
  | 'exchange_rate'
  | 'receipt'
type Person = { id: string; name: string }

/** `preset`: the catalogue entry the category still is (shown in the user's language); null once someone renamed it. */
export type CategoryRef = { id: string; name: string; account_code: string; preset: string | null }
export type CategoryInput = { name: string; account_code: string; vat_treatment?: VatTreatment }
export type CategoryUpdate = Partial<CategoryInput> & { is_archived?: boolean }
export type VatTreatment = 'standard' | 'reduced' | 'lodging' | 'exempt' | 'none'
export type ExpenseCategory = CategoryRef & {
  vat_treatment: VatTreatment | null
  is_archived: boolean
  expenses_count: number
}

export type ExpenseLine = {
  id: string
  position: number
  description: string | null
  amount: Decimal
  vat_rate: Decimal
  /** The item's own category (its account takes the item's share in the books); null: the expense's. */
  category: CategoryRef | null
  /** Shown only: amount is the figure. */
  quantity: Decimal | null
  unit_price: Decimal | null
}

export type Expense = {
  id: string
  number: number
  status: ExpenseStatus
  source: 'manual' | 'import'
  supplier_name: string | null
  supplier_vat_number: string | null
  /** ISO alpha-2; outside CH/LI its VAT is not Swiss input tax. */
  supplier_country: string
  reference: string | null
  /** A warning, never a block: the oldest other non-void expense with the same supplier and reference. */
  duplicate_of: { id: string; number: number; date: string | null } | null
  description: string | null
  category: CategoryRef | null
  document_date: string | null
  due_date: string | null
  currency: string
  amount_mode: AmountMode
  entry_mode: EntryMode
  lines: ExpenseLine[]
  net_total: Decimal
  vat_total: Decimal
  total: Decimal
  vat_breakdown: {
    rate: Decimal
    taxable_amount: Decimal
    vat_amount: Decimal
    deductible_amount: Decimal
  }[]
  input_tax: InputTax
  deductible_percent: Decimal
  deductible_vat: Decimal
  exchange_rate: Decimal
  exchange_rate_date: string | null
  exchange_rate_source: RateSource | null
  base: {
    currency: string
    net_total: Decimal
    vat_total: Decimal
    total: Decimal
    deductible_vat: Decimal
  }
  payment_status: 'unpaid' | 'paid'
  paid_on: string | null
  payment_method: PaymentMethod | null
  paid_by_member: Person | null
  reimbursed_on: string | null
  is_overdue: boolean
  note: string | null
  receipt_missing_reason: string | null
  receipts_count: number
  is_complete: boolean
  missing_fields: MissingField[]
  created_by: Person | null
  booked_at: string | null
  booked_by: Person | null
  voided_at: string | null
  voided_by: Person | null
  void_reason: string | null
  /** The latest approval request of a draft (or the approval it was booked with); null without one. */
  approval_state: Exclude<ApprovalState, 'none'> | null
  created_at: string
  updated_at: string
}

export type ExpenseInput = {
  supplier_name: string | null
  supplier_vat_number: string | null
  supplier_country: string
  reference: string | null
  description: string | null
  category_id: string | null
  document_date: string | null
  due_date: string | null
  currency: string
  amount_mode: AmountMode
  entry_mode: EntryMode
  lines: {
    description: string | null
    amount: Decimal
    vat_rate: Decimal
    category_id?: string | null
    quantity?: Decimal | null
    unit_price?: Decimal | null
  }[]
  input_tax: InputTax
  deductible_percent: Decimal
  exchange_rate: Decimal
  exchange_rate_date: string | null
  exchange_rate_source: RateSource | null
  payment_status: 'unpaid' | 'paid'
  paid_on: string | null
  payment_method: PaymentMethod | null
  paid_by_member_id: string | null
  reimbursed_on: string | null
  note: string | null
  receipt_missing_reason: string | null
}

export type Receipt = ClientFile

type AmountCount = { amount: Decimal; count: number }
export type Summary = {
  currency: string
  this_month: AmountCount
  last_month: AmountCount
  unpaid: AmountCount
  overdue: AmountCount
  to_reimburse: AmountCount
  input_vat: { period: string; amount: Decimal }
  incomplete: { count: number }
  by_category: { category: CategoryRef | null; amount: Decimal }[]
  monthly: { month: string; amount: Decimal }[]
  views: Record<'review' | 'unpaid' | 'reimburse', number>
}

export type BulkAction = 'book' | 'mark_paid' | 'mark_unpaid' | 'mark_reimbursed' | 'delete'
export type BulkResult = { updated: number; skipped: { id: string; reason: string }[] }

export const MISSING_LABELS: Record<MissingField, string> = {
  supplier_name: translate('supplier'),
  document_date: translate('date'),
  category: translate('category'),
  total: translate('amount'),
  items: translate('itemNames'),
  exchange_rate: translate('exchangeRate'),
  receipt: translate('receipt'),
}

export const RATE_SOURCES: { value: RateSource; label: string }[] = [
  { value: 'estv_monthly', label: translate('estvMonthlyRate') },
  { value: 'estv_daily', label: translate('estvDailyRate') },
  { value: 'bank', label: translate('bankStatement') },
  { value: 'manual', label: translate('other') },
]

// The list

/** The tabs: each is a status and payment filter. */
export const VIEWS = ['all', 'review', 'unpaid', 'reimburse', 'void'] as const
export type View = (typeof VIEWS)[number]
export const SORT_FIELDS = ['number', 'document_date', 'supplier', 'total', 'created_at'] as const
export type SortField = (typeof SORT_FIELDS)[number]

export type ListParams = {
  page: number
  /** Rows per page, a choice kept in this browser (not in the URL). */
  pageSize?: number
  search: string
  view: View
  categories: string[]
  from: string
  to: string
  currencies: string[]
  totalMin: string | null
  totalMax: string | null
  receipt: 'attached' | 'missing' | null
  sort: SortField
  desc: boolean
}

export const PAGE_SIZE = 50
export const DEFAULT_PARAMS: ListParams = {
  page: 1,
  search: '',
  view: 'all',
  categories: [],
  from: '',
  to: '',
  currencies: [],
  totalMin: null,
  totalMax: null,
  receipt: null,
  sort: 'document_date',
  desc: true,
}

const oneOf = <T extends string>(list: readonly T[], value: string | null): value is T =>
  value !== null && (list as readonly string[]).includes(value)
const isDate = (value: string | null): value is string =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** The list's state from the page URL. Anything unknown or malformed falls back to the default. */
export function parseListParams(query: URLSearchParams): ListParams {
  const page = Number(query.get('page'))
  const sort = query.get('sort') ?? ''
  const field = sort.replace(/^-/, '')
  const view = query.get('view')
  const from = query.get('from')
  const to = query.get('to')
  const receipt = query.get('receipt')
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    search: query.get('q') ?? '',
    view: oneOf(VIEWS, view) ? view : 'all',
    categories: [...new Set(query.getAll('category').filter(Boolean))],
    from: isDate(from) ? from : '',
    to: isDate(to) ? to : '',
    currencies: [
      ...new Set(
        query
          .getAll('currency')
          .map((code) => code.toUpperCase())
          .filter((code) => /^[A-Z]{3}$/.test(code)),
      ),
    ],
    totalMin: amountParam(query.get('min')),
    totalMax: amountParam(query.get('max')),
    receipt: receipt === 'attached' || receipt === 'missing' ? receipt : null,
    sort: oneOf(SORT_FIELDS, field) ? field : DEFAULT_PARAMS.sort,
    desc: oneOf(SORT_FIELDS, field) ? sort.startsWith('-') : DEFAULT_PARAMS.desc,
  }
}

/** The list's state as URL query, leaving out defaults so links stay short. Keeps other keys. */
export function listParamsToQuery(params: ListParams, base = new URLSearchParams()) {
  const query = new URLSearchParams(base)
  for (const key of [
    'page',
    'q',
    'view',
    'category',
    'from',
    'to',
    'currency',
    'min',
    'max',
    'receipt',
    'sort',
  ])
    query.delete(key)
  if (params.page > 1) query.set('page', String(params.page))
  if (params.search) query.set('q', params.search)
  if (params.view !== 'all') query.set('view', params.view)
  for (const id of params.categories) query.append('category', id)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  for (const code of params.currencies) query.append('currency', code)
  if (params.totalMin) query.set('min', params.totalMin)
  if (params.totalMax) query.set('max', params.totalMax)
  if (params.receipt) query.set('receipt', params.receipt)
  if (params.sort !== DEFAULT_PARAMS.sort || params.desc !== DEFAULT_PARAMS.desc)
    query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

const VIEW_QUERY: Record<View, Record<string, string>> = {
  all: {},
  review: { status: 'draft' },
  unpaid: { payment: 'unpaid' },
  reimburse: { payment: 'to_reimburse' },
  void: { status: 'void' },
}

/** The API's list query for `params` (the export takes the same filters, without paging). */
export function apiQuery(params: ListParams, paging = true) {
  const query = new URLSearchParams(VIEW_QUERY[params.view])
  if (paging) {
    query.set('page', String(params.page))
    query.set('page_size', String(params.pageSize ?? PAGE_SIZE))
  }
  const search = params.search.trim()
  if (search) query.set('search', search)
  for (const id of params.categories) query.append('category_id', id)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  for (const code of params.currencies) query.append('currency', code)
  if (params.totalMin) query.set('total_min', params.totalMin)
  if (params.totalMax) query.set('total_max', params.totalMax)
  if (params.receipt) query.set('receipt', params.receipt)
  query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

const path = (id: string) => `/expenses/${encodeURIComponent(id)}`

export const expensesApi = {
  list: (params: ListParams) => request<Page<Expense>>(`/expenses?${apiQuery(params)}`),
  summary: () => request<{ data: Summary }>('/expenses/summary'),
  get: (id: string) => request<{ data: Expense }>(path(id)),
  create: (input: Partial<ExpenseInput>) =>
    request<{ data: Expense }>('/expenses', { method: 'POST', json: input }),
  update: (id: string, input: Partial<ExpenseInput>) =>
    request<{ data: Expense }>(path(id), { method: 'PATCH', json: input }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  book: (id: string) => request<{ data: Expense }>(`${path(id)}/book`, { method: 'POST' }),
  void: (id: string, reason: string) =>
    request<{ data: Expense }>(`${path(id)}/void`, { method: 'POST', json: { reason } }),
  duplicate: (id: string) =>
    request<{ data: Expense }>(`${path(id)}/duplicate`, { method: 'POST' }),
  bulk: (ids: string[], action: BulkAction) =>
    request<{ data: BulkResult }>('/expenses/bulk', { method: 'POST', json: { ids, action } }),
  receipts: (id: string) => request<{ data: Receipt[] }>(`${path(id)}/receipts`),
  deleteReceipt: (id: string, receiptId: string) =>
    request<void>(`${path(id)}/receipts/${encodeURIComponent(receiptId)}`, { method: 'DELETE' }),
  // Stored names (lang=en): an import record names its category by them; the platform translates presets itself.
  categories: (archived = false) =>
    request<{ data: ExpenseCategory[] }>(
      `/expense-categories?lang=en${archived ? '&include_archived=1' : ''}`,
    ),
  createCategory: (input: CategoryInput) =>
    request<{ data: ExpenseCategory }>('/expense-categories?lang=en', {
      method: 'POST',
      json: input,
    }),
  updateCategory: (id: string, input: CategoryUpdate) =>
    request<{ data: ExpenseCategory }>(`/expense-categories/${encodeURIComponent(id)}?lang=en`, {
      method: 'PATCH',
      json: input,
    }),
}

// Downloads go through plain links so the browser sends the session cookie and saves the file.
export const exportUrl = (params: ListParams) =>
  `/api/v1/expenses/export?${apiQuery(params, false)}`
export const exportIdsUrl = (ids: string[]) =>
  `/api/v1/expenses/export?${new URLSearchParams({ ids: ids.join(',') })}`
export const receiptUrl = (id: string, receiptId: string, inline = false) =>
  `/api/v1${path(id)}/receipts/${encodeURIComponent(receiptId)}${inline ? '?inline=1' : ''}`

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (params: ListParams) => ['expenses', 'list', params] as const,
  summary: ['expenses', 'summary'] as const,
  detail: (id: string) => ['expenses', id] as const,
  receipts: (id: string) => ['expenses', id, 'receipts'] as const,
  categories: ['expense-categories'] as const,
}

export const expenseListQuery = (params: ListParams) => ({
  queryKey: expenseKeys.list(params),
  queryFn: () => expensesApi.list(params),
})

export function useExpenseList(params: ListParams) {
  return useQuery({ ...expenseListQuery(params), placeholderData: keepPreviousData })
}

export function useExpenseSummary() {
  return useQuery({
    queryKey: expenseKeys.summary,
    queryFn: async () => (await expensesApi.summary()).data,
  })
}

export const expenseQuery = (id: string) => ({
  queryKey: expenseKeys.detail(id),
  queryFn: async () => (await expensesApi.get(id)).data,
})

export function useExpense(id: string | null) {
  return useQuery({ ...expenseQuery(id ?? ''), enabled: id !== null })
}

export function useReceipts(id: string) {
  return useQuery({
    queryKey: expenseKeys.receipts(id),
    queryFn: async () => (await expensesApi.receipts(id)).data,
  })
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: expenseKeys.categories,
    queryFn: async () => (await expensesApi.categories()).data,
    staleTime: 5 * 60_000,
  })
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient()
  return useMutation<ExpenseCategory, ApiError, { id: string; input: CategoryUpdate }>({
    mutationFn: async ({ id, input }) => (await expensesApi.updateCategory(id, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: expenseKeys.categories })
      // Expenses carry the category's name and account.
      void queryClient.invalidateQueries({ queryKey: expenseKeys.all })
    },
  })
}

/** Every category, archived ones too: for managing them. */
export function useAllExpenseCategories() {
  return useQuery({
    queryKey: [...expenseKeys.categories, 'all'],
    queryFn: async () => (await expensesApi.categories(true)).data,
  })
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient()
  return useMutation<ExpenseCategory, ApiError, CategoryInput>({
    mutationFn: async (input) => (await expensesApi.createCategory(input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: expenseKeys.categories }),
  })
}

/** The server's computation of a form's input (as JSON text, so equal input is one cache entry). */
export function useExpensePreview(input: string | null) {
  return useQuery({
    queryKey: ['expenses', 'preview', input],
    queryFn: async () =>
      (
        await request<{ data: Expense }>('/expenses/preview', {
          method: 'POST',
          json: JSON.parse(input ?? '{}'),
        })
      ).data,
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  })
}

/** After a write: this expense's cache, the lists and the figures. */
export function refreshExpenses(queryClient: QueryClient, expense?: Expense) {
  if (expense) queryClient.setQueryData(expenseKeys.detail(expense.id), expense)
  void queryClient.invalidateQueries({ queryKey: ['expenses', 'list'] })
  void queryClient.invalidateQueries({ queryKey: expenseKeys.summary })
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
}

export function useSaveExpense() {
  const queryClient = useQueryClient()
  return useMutation<Expense, ApiError, { id?: string; input: Partial<ExpenseInput> }>({
    mutationFn: async ({ id, input }) =>
      (id ? await expensesApi.update(id, input) : await expensesApi.create(input)).data,
    onSuccess: (expense) => refreshExpenses(queryClient, expense),
  })
}

/** Book, void or duplicate: each answers the expense it changed or made. */
export function useExpenseAction<Variables>(
  run: (variables: Variables) => Promise<{ data: Expense }>,
) {
  const queryClient = useQueryClient()
  return useMutation<Expense, ApiError, Variables>({
    mutationFn: async (variables) => (await run(variables)).data,
    onSuccess: (expense) => refreshExpenses(queryClient, expense),
  })
}

export function useDeleteExpense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: expensesApi.remove,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: expenseKeys.detail(id) })
      refreshExpenses(queryClient)
    },
  })
}

export function useBulkExpenses() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: BulkAction }) =>
      (await expensesApi.bulk(ids, action)).data,
    onSuccess: (_, { ids }) => {
      for (const id of ids) void queryClient.invalidateQueries({ queryKey: expenseKeys.detail(id) })
      refreshExpenses(queryClient)
    },
  })
}

export function useDeleteReceipt(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (receiptId: string) => expensesApi.deleteReceipt(id, receiptId),
    onSuccess: () => receiptsChanged(queryClient, id),
  })
}

/**
 * After receipts were added or removed: the receipt decides completeness, so the expense (status, missing fields,
 * Book), the lists' badges and the figures are read again along with the receipts.
 */
export function receiptsChanged(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: expenseKeys.receipts(id) })
  void queryClient.invalidateQueries({ queryKey: expenseKeys.detail(id), exact: true })
  refreshExpenses(queryClient)
}

/** VAT charged outside Switzerland and Liechtenstein: not reclaimable as Swiss input tax. */
export const isForeignVat = (country: string) => country !== 'CH' && country !== 'LI'

export const FOREIGN_VAT_HINT = translate('foreignVATIsnTReclaimableSwissInputTaxYou')

/** Who may void booked expenses and manage categories. */
export const canManageExpenses = (role: string | undefined) => role === 'owner' || role === 'admin'

/** The words for where an expense stands, and the badge tone. */
export function expenseState(
  expense: Pick<Expense, 'status' | 'is_complete' | 'payment_status' | 'is_overdue'>,
) {
  if (expense.status === 'void')
    return { label: translate('void2'), tone: STATUS_TONES.expense.void }
  if (expense.status === 'draft')
    return expense.is_complete
      ? { label: translate('readyToBook'), tone: STATUS_TONES.expense.ready }
      : { label: translate('incomplete'), tone: STATUS_TONES.expense.incomplete }
  if (expense.payment_status === 'paid')
    return { label: translate('paid'), tone: STATUS_TONES.expense.paid }
  return expense.is_overdue
    ? { label: translate('overdue3'), tone: STATUS_TONES.expense.overdue }
    : { label: translate('unpaid'), tone: STATUS_TONES.expense.unpaid }
}

export const RECEIPT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif'
export const RECEIPT_MAX_FILES = 10

/** iPhone photos: the AI import can't read them; the manual form keeps them as receipts. */
export const isHeic = (file: File) =>
  /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/.test(file.type)

/** Uploads receipts with progress (0–1); rejects with the server's reason (type, size, count). */
export function uploadReceipts(
  id: string,
  files: File[],
  onProgress: (share: number) => void,
): Promise<Receipt[]> {
  return uploadInPacks<Receipt>(`/api/v1${path(id)}/receipts`, files, MAX_FILE_BYTES, onProgress)
}

/** How clearly the AI could read a part of the receipt; the server lowers a part whose figures disagree. */
export type ReadConfidence = 'high' | 'medium' | 'low'
export const READ_GROUPS = [
  'supplier',
  'document',
  'totals',
  'vat_breakdown',
  'items',
  'payment',
] as const
export type ReadGroup = (typeof READ_GROUPS)[number]

export type ReadBand = {
  rate: string | null
  net: string | null
  vat: string | null
  gross: string | null
}
export type ReadItem = {
  description: string | null
  quantity: string | null
  unit_price: string | null
  amount: string | null
  vat_rate: string | null
  /** The workspace category the AI put this item in, if any. */
  category_id: string | null
}

/**
 * Receipt reading v2 (POST /expenses/receipt-preview and POST /expenses/{id}/read), checked by the server: a null is
 * "not on the receipt" (or not trusted) and never clears a value.
 */
export type ReceiptSuggestions = {
  supplier: {
    name: string | null
    vat_number: string | null
    country: string | null
    iban: string | null
  }
  document: {
    type: 'receipt' | 'invoice' | 'credit_note' | null
    number: string | null
    date: string | null
    due_date: string | null
  }
  description: string | null
  currency: string | null
  totals: { net: string | null; vat: string | null; gross: string | null }
  vat_breakdown: ReadBand[]
  items: ReadItem[]
  payment: {
    status: 'paid' | 'unpaid' | 'unknown'
    method: PaymentMethod | null
    paid_on: string | null
  }
  reverse_charge: boolean
  /** One of the workspace's categories, with the AI's confidence from 0 to 1. */
  category: {
    id: string
    name: string
    account_code: string
    preset: string | null
    confidence: number
    reason: string | null
  } | null
  confidence: Record<ReadGroup, ReadConfidence>
  /** A message per part to check (supplier, document, totals, vat_breakdown, items, payment, category, reverse_charge). */
  issues: Record<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const pick = <T extends string>(value: unknown, choices: readonly T[]): T | null =>
  choices.find((choice) => choice === value) ?? null
const rec = (value: unknown) => (isRecord(value) ? value : {})
const list = (value: unknown) => (Array.isArray(value) ? value.map(rec) : [])
const PAYMENT_METHODS = ['card', 'cash', 'bank_transfer', 'twint', 'other'] as const

/** The answer of a receipt reading, kept to the shapes it should hold. */
export function parseSuggestions(body: unknown): ReceiptSuggestions {
  const data = rec(rec(body).data)
  const supplier = rec(data.supplier)
  const document = rec(data.document)
  const totals = rec(data.totals)
  const payment = rec(data.payment)
  const category = rec(data.category)
  const confidence = rec(data.confidence)
  const level = (group: ReadGroup) =>
    pick(confidence[group], ['high', 'medium', 'low'] as const) ?? 'medium'
  return {
    supplier: {
      name: str(supplier.name),
      vat_number: str(supplier.vat_number),
      country: str(supplier.country),
      iban: str(supplier.iban),
    },
    document: {
      type: pick(document.type, ['receipt', 'invoice', 'credit_note'] as const),
      number: str(document.number),
      date: str(document.date),
      due_date: str(document.due_date),
    },
    description: str(data.description),
    currency: str(data.currency),
    totals: { net: str(totals.net), vat: str(totals.vat), gross: str(totals.gross) },
    vat_breakdown: list(data.vat_breakdown).map((band) => ({
      rate: str(band.rate),
      net: str(band.net),
      vat: str(band.vat),
      gross: str(band.gross),
    })),
    items: list(data.items).map((item) => ({
      description: str(item.description),
      quantity: str(item.quantity),
      unit_price: str(item.unit_price),
      amount: str(item.amount),
      vat_rate: str(item.vat_rate),
      category_id: str(item.category_id),
    })),
    payment: {
      status: pick(payment.status, ['paid', 'unpaid'] as const) ?? 'unknown',
      method: pick(payment.method, PAYMENT_METHODS),
      paid_on: str(payment.paid_on),
    },
    reverse_charge: data.reverse_charge === true,
    category:
      str(category.id) && typeof category.confidence === 'number'
        ? {
            id: String(category.id),
            name: str(category.name) ?? '',
            account_code: str(category.account_code) ?? '',
            preset: str(category.preset),
            confidence: Math.min(1, Math.max(0, category.confidence)),
            reason: str(category.reason),
          }
        : null,
    confidence: {
      supplier: level('supplier'),
      document: level('document'),
      totals: level('totals'),
      vat_breakdown: level('vat_breakdown'),
      items: level('items'),
      payment: level('payment'),
    },
    issues: Object.fromEntries(
      Object.entries(rec(data.issues)).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  }
}

/**
 * Asks the AI to read up to five files as the pages of one receipt for the unsaved form; nothing is stored.
 * `requestId` names this one action, so the server refuses a repeat of it instead of reading (and charging) twice.
 */
export async function recognizeReceipt(files: File[], requestId: string, signal: AbortSignal) {
  const form = new FormData()
  form.set('request_id', requestId)
  for (const file of files) form.append('file', file, file.name)
  return parseSuggestions(
    await request<unknown>('/expenses/receipt-preview', { method: 'POST', form, signal }),
  )
}

/** Reads a draft's stored receipts again; nothing is stored, the person applies what they choose. */
export async function rereadExpense(id: string, requestId: string, signal?: AbortSignal) {
  return parseSuggestions(
    await request<unknown>(`/expenses/${id}/read`, {
      method: 'POST',
      json: { request_id: requestId },
      signal,
    }),
  )
}

/** Receipts worth sending: HEIC can't be read; the server explains anything else it refuses. */
export const canRecognize = (file: File) =>
  !isHeic(file) && /^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)
