'use client'

// Employees: the company's own staff, typed by hand from apps/api/internal/employees and internal/store
// (queries_employees.go). An employee is not a member: no access, no invitation, no seat.
import { formatMoney } from '@helvetly/ui/lib/format'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { request, type ApiError } from '@/lib/api'
import type { Page } from '@/lib/clients'

export type EmployeeStatus = 'active' | 'upcoming' | 'ended' | 'archived'
export type EmploymentType = 'permanent' | 'fixed_term' | 'temporary' | 'apprentice' | 'other'

export type Employee = {
  id: string
  member_user_id: string | null
  member_name: string | null
  member_active: boolean
  employee_number: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  street: string | null
  postal_code: string | null
  city: string | null
  address_country: string | null
  position: string | null
  department: string | null
  employment_type: EmploymentType
  /** A percentage as a decimal string ("80"). */
  working_time: string | null
  employment_start: string
  employment_end: string | null
  employing_entity: string
  employer_country: string
  social_security_country: string | null
  work_country: string
  work_region: string | null
  work_locality: string | null
  place_of_work: string | null
  residence_country: string | null
  cross_border: boolean
  cross_border_note: string | null
  /** The last characters only; the value is sealed and shown by `protected`. */
  bank_account_hint: string | null
  tax_id_hint: string | null
  legal_hold: boolean
  legal_hold_reason: string | null
  restricted: boolean
  status: EmployeeStatus
  erased_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** What a create or edit sends, field by field (the server validates each); `bank_account` and `tax_id` are
 * write-only. */
export type EmployeeInput = Partial<Record<string, string | boolean | null>>

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'fixed_term', label: 'Fixed term' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'apprentice', label: 'Apprentice' },
  { value: 'other', label: 'Other' },
]

export const STATUSES: { value: EmployeeStatus | 'all'; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'ended', label: 'Ended' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

export const fullName = (employee: Pick<Employee, 'first_name' | 'last_name'>) =>
  `${employee.first_name} ${employee.last_name}`.trim()

/** A missing amount is unknown, never 0: it shows as a dash. */
export const formatPay = (value: string | null | undefined, currency: string) =>
  value === null || value === undefined || value === '' ? '—' : formatMoney(value, currency)

/** The list's state as in the URL. */
export type ListParams = {
  search: string
  status: EmployeeStatus | 'all'
  department: string | null
}
export const DEFAULT_PARAMS: ListParams = { search: '', status: 'active', department: null }

const isStatus = (value: string | null): value is ListParams['status'] =>
  STATUSES.some((status) => status.value === value)

export function parseListParams(query: URLSearchParams): ListParams {
  const status = query.get('status')
  return {
    search: query.get('q') ?? '',
    status: isStatus(status) ? status : DEFAULT_PARAMS.status,
    department: query.get('department') || null,
  }
}

/** The list's state as URL query, without defaults; keeps other keys (`id`, `new`). */
export function listParamsToQuery(params: ListParams, base = new URLSearchParams()) {
  const query = new URLSearchParams(base)
  for (const key of ['q', 'status', 'department']) query.delete(key)
  if (params.search) query.set('q', params.search)
  if (params.status !== DEFAULT_PARAMS.status) query.set('status', params.status)
  if (params.department) query.set('department', params.department)
  return query
}

export function apiQuery(params: ListParams) {
  const query = new URLSearchParams({ status: params.status, page_size: '200' })
  const search = params.search.trim()
  if (search) query.set('search', search)
  if (params.department) query.set('department', params.department)
  return query
}

export type PayBasis = 'monthly' | 'hourly'
export type PayFrequency = 'monthly' | 'semimonthly' | 'biweekly' | 'weekly'
export type PayTerms = {
  id: string
  employee_id: string
  effective_from: string
  basis: PayBasis
  amount: string
  currency: string
  frequency: PayFrequency
  note: string | null
  /** The terms in effect today. */
  current: boolean
  created_by: string | null
  created_at: string
}
export type PayTermsInput = Pick<
  PayTerms,
  'effective_from' | 'basis' | 'amount' | 'currency' | 'frequency'
> & { note: string | null }

export const PAY_BASES: { value: PayBasis; label: string }[] = [
  { value: 'monthly', label: 'Monthly salary' },
  { value: 'hourly', label: 'Hourly rate' },
]
export const PAY_FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'weekly', label: 'Weekly' },
]

export type RetentionRule = {
  id: string
  jurisdiction: string
  topic: string
  document_type?: string
  summary?: string
  years?: number
  trigger_text?: string
  guidance?: string
  source?: string
  source_url: string
  checked_at: string
  status: string
}

export type EmployeeDocument = {
  id: string
  name: string
  size: number
  content_type: string
  type: string
  document_date: string | null
  retain_until: string | null
  /** The rule that set `retain_until`; null when a person set it. */
  retention_rule: string | null
  legal_hold: boolean
  uploaded_by: string | null
  created_at: string
  retention_guidance?: RetentionRule[]
  /** The retention date has passed: review it for deletion. */
  retention_due?: boolean
}

export const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'employment_contract', label: 'Employment contract' },
  { value: 'contract_amendment', label: 'Contract amendment' },
  { value: 'termination_document', label: 'Termination document' },
  { value: 'personnel_file', label: 'Personnel file' },
  { value: 'payslip', label: 'Payslip' },
  { value: 'payroll_record', label: 'Payroll record' },
  { value: 'tax_withholding_record', label: 'Tax withholding record' },
  { value: 'social_security_record', label: 'Social security record' },
  { value: 'time_record', label: 'Time record' },
  { value: 'work_permit_copy', label: 'Work permit copy' },
  { value: 'id_document_copy', label: 'ID document copy' },
  { value: 'other', label: 'Other' },
]
export const documentTypeLabel = (type: string) =>
  DOCUMENT_TYPES.find((entry) => entry.value === type)?.label ?? type

export type Resolution = {
  jurisdiction: string
  country_name: string
  group: string
  status: 'register_only' | 'ambiguous' | 'unsupported'
  mode: string
  reasons: string[]
  blocked: { feature: string; reason: string }[]
  applicable: string[]
}

export type Country = {
  code: string
  name: string
  group: string
  region_label?: string
  regions?: { code: string; name: string }[]
  locality: boolean
  research_status: string
}

export type EmploymentSettings = {
  employing_entity: string | null
  country: string | null
  region: string | null
  updated_at: string | null
}

export type HistoryEvent = {
  kind: string
  subject_type: string
  subject_id: string
  actor: string | null
  at: string
}

const HISTORY_LABELS: Record<string, string> = {
  'employee.created': 'Employee added',
  'employee.archived': 'Archived',
  'employee.unarchived': 'Restored from the archive',
  'employee.erased': 'Personal data erased',
  'employee.legal_hold_set': 'Legal hold set',
  'employee.legal_hold_lifted': 'Legal hold lifted',
  'employee.restricted': 'Processing restricted',
  'employee.unrestricted': 'Restriction lifted',
  'employee.pay_terms_added': 'Pay terms added',
  'employee.pay_terms_removed': 'Future pay terms removed',
  'employee.document_added': 'Document added',
  'employee.document_deleted': 'Document deleted',
  'employee.document_hold_set': 'Legal hold set on a document',
  'employee.document_hold_lifted': 'Legal hold lifted from a document',
  'payroll.approved': 'Payroll entry approved',
  'payroll.corrected': 'Payroll entry corrected',
  'payroll.paid': 'Payroll entry marked as paid',
  'payroll.unpaid': 'Payroll entry marked as unpaid',
}
/** "employee.pay_terms_added" as people read it; an unknown kind keeps its words. */
export const historyLabel = (kind: string) =>
  HISTORY_LABELS[kind] ?? kind.replace(/^[a-z]+\./, '').replaceAll('_', ' ')

const path = (id: string) => `/employees/${encodeURIComponent(id)}`

export const employeesApi = {
  list: (params: ListParams) =>
    request<Page<Employee> & { departments: string[] }>(`/employees?${apiQuery(params)}`),
  get: (id: string) => request<{ data: Employee }>(path(id)),
  create: (input: EmployeeInput) =>
    request<{ data: Employee }>('/employees', { method: 'POST', json: input }),
  update: (id: string, input: EmployeeInput) =>
    request<{ data: Employee }>(path(id), { method: 'PATCH', json: input }),
  archive: (id: string, archived: boolean) =>
    request<{ data: Employee }>(`${path(id)}/${archived ? 'archive' : 'unarchive'}`, {
      method: 'POST',
    }),
  erase: (id: string) =>
    request<{ data: Employee; deleted_documents: number; kept_documents: number }>(
      `${path(id)}/erase`,
      { method: 'POST' },
    ),
  protected: (id: string) =>
    request<{ data: { bank_account: string | null; tax_id: string | null } }>(
      `${path(id)}/protected`,
    ),
  jurisdiction: (id: string) => request<{ data: Resolution }>(`${path(id)}/jurisdiction`),
  history: (id: string) => request<{ data: HistoryEvent[] }>(`${path(id)}/history`),
  payTerms: (id: string) => request<{ data: PayTerms[] }>(`${path(id)}/pay-terms`),
  addPayTerms: (id: string, input: PayTermsInput) =>
    request<{ data: PayTerms[] }>(`${path(id)}/pay-terms`, { method: 'POST', json: input }),
  documents: (id: string) => request<{ data: EmployeeDocument[] }>(`${path(id)}/documents`),
  upload: (id: string, form: FormData) =>
    request<{ data: EmployeeDocument }>(`${path(id)}/documents`, { method: 'POST', form }),
  updateDocument: (id: string, doc: string, input: { legal_hold: boolean }) =>
    request<{ data: EmployeeDocument }>(`${path(id)}/documents/${encodeURIComponent(doc)}`, {
      method: 'PATCH',
      json: input,
    }),
  deleteDocument: (id: string, doc: string) =>
    request<void>(`${path(id)}/documents/${encodeURIComponent(doc)}`, { method: 'DELETE' }),
  settings: () => request<{ data: EmploymentSettings }>('/employment/settings'),
  putSettings: (input: Omit<EmploymentSettings, 'updated_at'>) =>
    request<{ data: EmploymentSettings }>('/employment/settings', { method: 'PUT', json: input }),
  jurisdictions: () => request<{ data: { countries: Country[] } }>('/employment/jurisdictions'),
}

/** A plain link, so the browser sends the session cookie and saves the file. */
export const documentDownloadUrl = (id: string, doc: string) =>
  `/api/v1${path(id)}/documents/${encodeURIComponent(doc)}/download`

export const employeeKeys = {
  all: ['employees'] as const,
  list: (params: ListParams) => ['employees', 'list', params] as const,
  detail: (id: string) => ['employees', id] as const,
  part: (id: string, part: 'jurisdiction' | 'history' | 'pay-terms' | 'documents') =>
    ['employees', id, part] as const,
  settings: ['employment', 'settings'] as const,
  jurisdictions: ['employment', 'jurisdictions'] as const,
}

export function useEmployeeList(params: ListParams) {
  return useQuery({
    queryKey: employeeKeys.list(params),
    queryFn: () => employeesApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useEmployee(id: string | null) {
  return useQuery({
    queryKey: employeeKeys.detail(id ?? ''),
    queryFn: async () => (await employeesApi.get(id ?? '')).data,
    enabled: id !== null,
  })
}

const usePart = <T>(
  id: string,
  part: Parameters<typeof employeeKeys.part>[1],
  get: () => Promise<{ data: T }>,
  enabled = true,
) =>
  useQuery({
    queryKey: employeeKeys.part(id, part),
    queryFn: async () => (await get()).data,
    enabled,
  })

export const useJurisdiction = (id: string) =>
  usePart(id, 'jurisdiction', () => employeesApi.jurisdiction(id))
export const useEmployeeHistory = (id: string, enabled: boolean) =>
  usePart(id, 'history', () => employeesApi.history(id), enabled)
export const usePayTerms = (id: string, enabled: boolean) =>
  usePart(id, 'pay-terms', () => employeesApi.payTerms(id), enabled)
export const useEmployeeDocuments = (id: string, enabled: boolean) =>
  usePart(id, 'documents', () => employeesApi.documents(id), enabled)

export function useEmploymentSettings(enabled = true) {
  return useQuery({
    queryKey: employeeKeys.settings,
    queryFn: async () => (await employeesApi.settings()).data,
    enabled,
  })
}

/** The modelled countries; the list is part of the binary, so it never goes stale. */
export function useCountries() {
  return useQuery({
    queryKey: employeeKeys.jurisdictions,
    queryFn: async () => (await employeesApi.jurisdictions()).data.countries,
    staleTime: Infinity,
  })
}

/** After a write: this employee's cache and everything under it, and the lists. */
function refresh(queryClient: QueryClient, employee?: Employee) {
  if (employee) {
    queryClient.setQueryData(employeeKeys.detail(employee.id), employee)
    void queryClient.invalidateQueries({ queryKey: employeeKeys.detail(employee.id) })
  }
  void queryClient.invalidateQueries({ queryKey: ['employees', 'list'] })
}

export function useSaveEmployee() {
  const queryClient = useQueryClient()
  return useMutation<Employee, ApiError, { id?: string; input: EmployeeInput }>({
    mutationFn: async ({ id, input }) =>
      (id ? await employeesApi.update(id, input) : await employeesApi.create(input)).data,
    onSuccess: (employee) => refresh(queryClient, employee),
  })
}

export function useArchiveEmployee() {
  const queryClient = useQueryClient()
  return useMutation<Employee, ApiError, { id: string; archived: boolean }>({
    mutationFn: async ({ id, archived }) => (await employeesApi.archive(id, archived)).data,
    onSuccess: (employee) => refresh(queryClient, employee),
  })
}

export function useEraseEmployee() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: employeesApi.erase,
    onSuccess: (result) => refresh(queryClient, result.data),
  })
}

export function useAddPayTerms(id: string) {
  const queryClient = useQueryClient()
  return useMutation<PayTerms[], ApiError, PayTermsInput>({
    mutationFn: async (input) => (await employeesApi.addPayTerms(id, input)).data,
    onSuccess: (list) => {
      queryClient.setQueryData(employeeKeys.part(id, 'pay-terms'), list)
      void queryClient.invalidateQueries({ queryKey: employeeKeys.part(id, 'history') })
    },
  })
}

function useDocumentWrite<V>(id: string, write: (input: V) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation<unknown, ApiError, V>({
    mutationFn: write,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.part(id, 'documents') })
      void queryClient.invalidateQueries({ queryKey: employeeKeys.part(id, 'history') })
    },
  })
}

export const useUploadDocument = (id: string) =>
  useDocumentWrite(id, (form: FormData) => employeesApi.upload(id, form))
export const useDocumentHold = (id: string) =>
  useDocumentWrite(id, ({ doc, hold }: { doc: string; hold: boolean }) =>
    employeesApi.updateDocument(id, doc, { legal_hold: hold }),
  )
export const useDeleteDocument = (id: string) =>
  useDocumentWrite(id, (doc: string) => employeesApi.deleteDocument(id, doc))

/** Reveals the bank account and tax id; a mutation, so the values live only in the view's state. */
export function useRevealProtected(id: string) {
  return useMutation({ mutationFn: async () => (await employeesApi.protected(id)).data })
}

export function useSaveEmploymentSettings() {
  const queryClient = useQueryClient()
  return useMutation<EmploymentSettings, ApiError, Omit<EmploymentSettings, 'updated_at'>>({
    mutationFn: async (input) => (await employeesApi.putSettings(input)).data,
    onSuccess: (settings) => queryClient.setQueryData(employeeKeys.settings, settings),
  })
}

/** "Zurich, Switzerland" from the country list; codes alone while it loads. */
export function placeLabel(
  countries: Country[] | undefined,
  country: string,
  region: string | null,
): string {
  const found = countries?.find((entry) => entry.code === country)
  const regionName = found?.regions?.find((entry) => entry.code === region)?.name ?? region
  return [regionName, found?.name ?? country].filter(Boolean).join(', ')
}
