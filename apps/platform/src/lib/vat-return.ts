// The Swiss VAT return (MWST-Abrechnung), typed by hand from docs/vat-return-contract.md.
import { request, respond } from '@/lib/api'

export type VATMethod = 'effective' | 'net_tax_rate'
export type VATPeriodLength = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'
export type NetRate = { label: string; rate: string }
export type VATReturnSettings = {
  method: VATMethod
  period: VATPeriodLength
  basis: 'agreed' | 'received'
  net_rates: NetRate[]
}
export type VATReturnLine = {
  ziffer: string
  label_de: string
  label_en: string
  kind: 'amount' | 'rate' | 'total'
  amount: string
  base: string
  rate: string
  tax: string
  sources: number
  tracked: boolean
}
export type VATReturnWarning = { code: string; message: string; refs: string[] }
export type VATReturn = {
  period: string
  from: string
  to: string
  method: VATMethod
  basis: 'agreed' | 'received'
  currency: 'CHF'
  months: number
  closed_months: number
  net_rates: NetRate[]
  lines: VATReturnLine[]
  warnings: VATReturnWarning[]
}

type One<T> = { data: T }

export const vatReturnApi = {
  report: (period?: string) =>
    request<One<VATReturn>>(`/vat-return${period ? `?period=${encodeURIComponent(period)}` : ''}`),
  settings: () => request<One<VATReturnSettings>>('/vat-return/settings'),
  saveSettings: (input: VATReturnSettings) =>
    request<One<VATReturnSettings>>('/vat-return/settings', { method: 'PUT', json: input }),
  /** The eCH-0217 file for the ESTV ePortal; a 409 `cannot_export` lists its reasons in details. */
  estvXml: (period: string) =>
    respond(`/vat-return?period=${encodeURIComponent(period)}&format=xml`),
}

export type ExportReason = { code: string; message: string }

/** The reasons of a refused ESTV export. */
export function exportReasons(details: Record<string, unknown>): ExportReason[] {
  const reasons = details.reasons
  if (!Array.isArray(reasons)) return []
  return reasons.flatMap((r: unknown) =>
    typeof r === 'object' &&
    r !== null &&
    'message' in r &&
    typeof r.message === 'string' &&
    'code' in r &&
    typeof r.code === 'string'
      ? [{ code: r.code, message: r.message }]
      : [],
  )
}

// A plain link so the browser sends the session cookie and saves the file.
export const vatReturnFileUrl = (period: string, format: 'csv' | 'pdf') =>
  `/api/v1/vat-return?period=${encodeURIComponent(period)}&format=${format}`

const MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 } as const

const periodName = (length: VATPeriodLength, year: number, month: number) => {
  if (length === 'yearly') return String(year)
  if (length === 'monthly') return `${year}-${String(month).padStart(2, '0')}`
  if (length === 'half_yearly') return `${year}-H${month <= 6 ? 1 : 2}`
  return `${year}-Q${Math.ceil(month / 3)}`
}

/** The `count` periods of that length that have ended by `todayIso`, newest first: "2026-Q3", "2026-Q2", … */
export function endedPeriods(length: VATPeriodLength, todayIso: string, count: number): string[] {
  const [year = 0, month = 1] = todayIso.split('-').map(Number)
  const size = MONTHS[length]
  const current = month - 1 - ((month - 1) % size) // 0-based first month of today's period
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(Date.UTC(year, current - size * (i + 1), 1))
    return periodName(length, start.getUTCFullYear(), start.getUTCMonth() + 1)
  })
}
