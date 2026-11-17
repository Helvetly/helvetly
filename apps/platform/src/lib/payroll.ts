'use client'

// The payroll register, typed by hand from apps/api/internal/employees (payroll.go, bookings.go) and
// internal/store/queries_payroll.go. Entries record pay computed elsewhere: saving one certifies nothing,
// approving one is a person's confirmation, and neither means it was paid.
import { languageTag } from '@helvetly/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, type ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'

export type ComponentKind = 'earning' | 'deduction' | 'employer_cost'
export type PayrollComponent = { kind: ComponentKind; label: string; amount: string }

export type PayrollEntry = {
  id: string
  employee_id: string
  employee_name: string
  employee_number: string | null
  employing_entity: string
  period_start: string
  period_end: string
  pay_date: string | null
  currency: string
  /** null: not known (never 0). */
  gross: string | null
  deductions: string | null
  net: string | null
  employer_costs: string | null
  total_cost: string | null
  complete: boolean
  components: PayrollComponent[]
  source: string
  source_ref: string | null
  status: 'draft' | 'approved'
  payment_status: 'unpaid' | 'paid'
  paid_on: string | null
  approved_by: string | null
  approved_at: string | null
  supersedes_id: string | null
  superseded_by: string | null
  booked: string[]
  version: number
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /** User ids: who created, last changed and approved the entry (four-eyes approval and its audit). */
  created_by_id: string | null
  updated_by_id: string | null
  approved_by_id: string | null
}

export type EntryInput = {
  employee_id?: string
  period_start?: string
  period_end?: string
  pay_date?: string | null
  currency?: string
  gross?: string | null
  deductions?: string | null
  net?: string | null
  employer_costs?: string | null
  components?: PayrollComponent[]
  source_ref?: string | null
  note?: string | null
}

export type PayrollTotals = {
  currency: string
  entries: number
  drafts: number
  approved: number
  paid: number
  gross: string
  deductions: string
  net: string
  employer_costs: string
  total_cost: string
  missing_gross: number
  missing_deductions: number
  missing_net: number
  missing_employer_costs: number
  net_paid: string
}

export type BookingCandidate = {
  entry: PayrollEntry
  kind: 'accrual' | 'reversal' | 'payment'
  date: string
  /** Why it cannot be booked; empty when it can. */
  blocked: string
  paid_before?: string
}
export type BookingPreview = { up_to: string; base_currency: string; items: BookingCandidate[] }
export type PayrollBooking = {
  id: string
  up_to: string
  base_currency: string
  items: number
  created_by: string | null
  created_at: string
}

export const COMPONENT_KINDS: { value: ComponentKind; label: string }[] = [
  { value: 'earning', label: translate('payrollKindEarning') },
  { value: 'deduction', label: translate('payrollKindDeduction') },
  { value: 'employer_cost', label: translate('payrollKindEmployerCost') },
]

export const BOOKING_FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'banana', label: 'Banana' },
  { value: 'bexio', label: 'bexio' },
  { value: 'abacus', label: 'Abacus' },
] as const

/** The CSV columns the payroll import reads (apps/api/internal/employees/imports.go). */
export const IMPORT_COLUMNS = [
  'employee_number|email',
  'period_start',
  'period_end',
  'currency',
  'gross',
  'deductions',
  'net',
  'employer_costs',
  'pay_date',
  'source_ref',
  'note',
]

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** The month in the URL, else the current one (YYYY-MM). */
export const monthOr = (value: string | null, today: Date = new Date()) =>
  value && MONTH.test(value) ? value : today.toISOString().slice(0, 7)

/** "2026-11" moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, index - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

/** The first and last day of a month, a new entry's default period. */
export function monthPeriod(month: string): { start: string; end: string } {
  const [year = 0, index = 1] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

/** "November 2026" */
export const monthLabel = (month: string) =>
  new Intl.DateTimeFormat(languageTag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  )

/** "n entries missing net pay" lines for a currency's totals. */
export function missingNotes(totals: PayrollTotals): string[] {
  return (
    [
      [totals.missing_gross, translate('payrollMissingGross')],
      [totals.missing_deductions, translate('payrollMissingDeductions')],
      [totals.missing_net, translate('payrollMissingNet')],
      [totals.missing_employer_costs, translate('payrollMissingEmployerCosts')],
    ] as const
  ).flatMap(([count, what]) =>
    count > 0 ? [translate('payrollEntriesMissing', { count, what })] : [],
  )
}

/** The person whose figures an entry carries: its last editor, else its creator. */
export const authorOf = (entry: PayrollEntry) => entry.updated_by_id ?? entry.created_by_id

/**
 * Why the signed-in person may not approve a draft under four-eyes approval, or null when they may: they entered
 * its current figures (the server refuses with `second_approver_required` too).
 */
export function approvalBlock(
  entry: PayrollEntry,
  userId: string | undefined,
  settings: { require_second_approver: boolean; payroll_approvers: number } | undefined,
): string | null {
  if (!settings?.require_second_approver || !userId || authorOf(entry) !== userId) return null
  return settings.payroll_approvers < 2
    ? `${translate('payrollYouEnteredThese')} ${translate('payrollNobodyElseCanApprove')}`
    : translate('payrollYouEnteredThese')
}

const entryPath = (id: string) => `/payroll/entries/${encodeURIComponent(id)}`

export const payrollApi = {
  entries: (month: string, superseded: boolean) =>
    request<{ data: PayrollEntry[] }>(
      `/payroll/entries?${new URLSearchParams({ month, ...(superseded ? { superseded: 'true' } : {}) })}`,
    ),
  summary: (month: string) =>
    request<{ data: { month: string; currencies: PayrollTotals[] } }>(
      `/payroll/summary?${new URLSearchParams({ month })}`,
    ),
  create: (input: EntryInput) =>
    request<{ data: PayrollEntry }>('/payroll/entries', { method: 'POST', json: input }),
  update: (id: string, version: number, input: EntryInput) =>
    request<{ data: PayrollEntry }>(entryPath(id), {
      method: 'PATCH',
      json: { ...input, version },
    }),
  remove: (id: string) => request<void>(entryPath(id), { method: 'DELETE' }),
  approve: (id: string, version: number) =>
    request<{ data: PayrollEntry }>(`${entryPath(id)}/approve`, {
      method: 'POST',
      json: { version },
    }),
  payment: (id: string, version: number, paidOn: string | null) =>
    request<{ data: PayrollEntry }>(`${entryPath(id)}/payment`, {
      method: 'POST',
      json: paidOn ? { version, status: 'paid', paid_on: paidOn } : { version, status: 'unpaid' },
    }),
  correct: (id: string) =>
    request<{ data: PayrollEntry }>(`${entryPath(id)}/correct`, { method: 'POST' }),
  entry: (id: string) => request<{ data: PayrollEntry }>(entryPath(id)),
  bookings: () => request<{ data: PayrollBooking[] }>('/payroll/bookings'),
  preview: (to: string) =>
    request<{ data: BookingPreview }>(`/payroll/bookings/preview?${new URLSearchParams({ to })}`),
  book: (to: string) =>
    request<{ data: PayrollBooking }>('/payroll/bookings', { method: 'POST', json: { to } }),
}

export const exportUrl = (month: string) =>
  `/api/v1/payroll/export?${new URLSearchParams({ month })}`
export const bookingExportUrl = (id: string, format: string) =>
  `/api/v1/payroll/bookings/${encodeURIComponent(id)}/export?${new URLSearchParams({ format })}`

export const payrollKeys = {
  all: ['payroll'] as const,
  entries: (month: string, superseded: boolean) =>
    ['payroll', 'entries', month, superseded] as const,
  summary: (month: string) => ['payroll', 'summary', month] as const,
  entry: (id: string) => ['payroll', 'entry', id] as const,
  bookings: ['payroll', 'bookings'] as const,
  preview: (to: string) => ['payroll', 'preview', to] as const,
}

export function usePayrollEntries(month: string, superseded: boolean, enabled = true) {
  return useQuery({
    queryKey: payrollKeys.entries(month, superseded),
    queryFn: async () => (await payrollApi.entries(month, superseded)).data,
    enabled,
  })
}

export function usePayrollEntry(id: string | null) {
  return useQuery({
    queryKey: payrollKeys.entry(id ?? ''),
    queryFn: async () => (await payrollApi.entry(id ?? '')).data,
    enabled: id !== null,
  })
}

export function usePayrollSummary(month: string, enabled = true) {
  return useQuery({
    queryKey: payrollKeys.summary(month),
    queryFn: async () => (await payrollApi.summary(month)).data.currencies,
    enabled,
  })
}

export function useBookings(enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.bookings,
    queryFn: async () => (await payrollApi.bookings()).data,
    enabled,
  })
}

export function useBookingPreview(to: string, enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.preview(to),
    queryFn: async () => (await payrollApi.preview(to)).data,
    enabled,
  })
}

/** Every payroll write changes the entries, totals and what can be booked. */
function usePayrollWrite<V, R>(write: (input: V) => Promise<R>) {
  const queryClient = useQueryClient()
  return useMutation<R, ApiError, V>({
    mutationFn: write,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: payrollKeys.all }),
  })
}

export const useSaveEntry = () =>
  usePayrollWrite(
    async ({ id, version, input }: { id?: string; version?: number; input: EntryInput }) =>
      (id && version ? await payrollApi.update(id, version, input) : await payrollApi.create(input))
        .data,
  )
export const useApproveEntry = () =>
  usePayrollWrite(
    async (entry: PayrollEntry) => (await payrollApi.approve(entry.id, entry.version)).data,
  )
export const usePayment = () =>
  usePayrollWrite(
    async ({ entry, paidOn }: { entry: PayrollEntry; paidOn: string | null }) =>
      (await payrollApi.payment(entry.id, entry.version, paidOn)).data,
  )
export const useCorrectEntry = () =>
  usePayrollWrite(async (id: string) => (await payrollApi.correct(id)).data)
export const useDeleteEntry = () => usePayrollWrite(payrollApi.remove)
export const useBook = () => usePayrollWrite(async (to: string) => (await payrollApi.book(to)).data)
