// The general ledger, typed by hand from docs/ledger-contract.md.
import { request } from '@/lib/api'
import type { Sort, SortValue } from '@/lib/list-sort'

export type LedgerAccounts = {
  receivables: string
  revenue: string
  output_vat: string
  rounding: string
  payables: string
  member_payable: string
  input_vat_material: string
  input_vat_other: string
  bank: Record<string, string>
}
export type LedgerBalance = {
  account: string
  name: string
  currency: string
  opening: string
  debit: string
  credit: string
  closing: string
}
export const SORT_FIELDS = ['account', 'name', 'opening', 'debit', 'credit', 'closing'] as const
export type SortField = (typeof SORT_FIELDS)[number]
export const DEFAULT_SORT: Sort<SortField> = { field: 'account', desc: false }

/** What a trial-balance column sorts by: amounts by size, account and name as text. */
export const balanceSortValue = (row: LedgerBalance, field: SortField): SortValue =>
  field === 'account' || field === 'name' ? row[field] : Number(row[field])

export type LedgerStatementLine = {
  date: string
  ref: string
  description: string
  contra: string
  debit: string
  credit: string
  balance: string
}
export type LedgerStatement = {
  account: string
  name: string
  currency: string
  opening: string
  closing: string
  lines: LedgerStatementLine[]
}
export type LedgerReport = {
  from: string
  to: string
  currency: string
  balances: LedgerBalance[]
  unposted: { ref: string; reason: string }[]
}

type One<T> = { data: T }

const range = (from: string, to: string) =>
  `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

export const fetchLedger = async (from: string, to: string) =>
  (await request<One<LedgerReport>>(`/ledger?${range(from, to)}`)).data

export const fetchStatement = async (code: string, currency: string, from: string, to: string) =>
  (
    await request<One<LedgerStatement>>(
      `/ledger/accounts/${encodeURIComponent(code)}?${range(from, to)}&currency=${encodeURIComponent(currency)}`,
    )
  ).data

export const fetchLedgerSettings = async () =>
  (await request<One<LedgerAccounts>>('/ledger/settings')).data

export const saveLedgerSettings = async (accounts: LedgerAccounts) =>
  (await request<One<LedgerAccounts>>('/ledger/settings', { method: 'PUT', json: accounts })).data

// A plain link so the browser sends the session cookie and saves the file.
export const ledgerExportUrl = (
  format: 'banana' | 'bexio' | 'abacus' | 'csv',
  from: string,
  to: string,
) => `/api/v1/ledger/export?${range(from, to)}&format=${format}`
