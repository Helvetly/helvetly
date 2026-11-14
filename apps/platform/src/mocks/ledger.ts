// Fake ledger API (Vitest only): an invoice of 1081.00 paid in cash plus one expense on 6640 Travel.
import { http, HttpResponse } from 'msw'

import type { LedgerAccounts, LedgerBalance, LedgerReport, LedgerStatement } from '@/lib/ledger'

const error = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })

const bal = (account: string, name: string, debit: string, credit: string, closing: string) =>
  ({ account, name, currency: 'CHF', opening: '0.00', debit, credit, closing }) as LedgerBalance

const balances: LedgerBalance[] = [
  bal('1000', 'Kasse', '1081.00', '0.00', '1081.00'),
  bal('1100', 'Forderungen aus Lieferungen und Leistungen', '1081.00', '1081.00', '0.00'),
  bal('2000', 'Verbindlichkeiten aus Lieferungen und Leistungen', '0.00', '50.00', '-50.00'),
  bal('2200', 'Geschuldete MWST', '0.00', '81.00', '-81.00'),
  bal('3200', 'Handelswarenertrag', '0.00', '1000.00', '-1000.00'),
  bal('6640', 'Reisespesen', '50.00', '0.00', '50.00'),
]

let accounts: LedgerAccounts = {
  receivables: '1100',
  revenue: '3200',
  output_vat: '2200',
  rounding: '3800',
  payables: '2000',
  member_payable: '2210',
  input_vat_material: '1170',
  input_vat_other: '1171',
  bank: { bank_transfer: '1020', card: '1020', twint: '1020', other: '1020', cash: '1000' },
}

const validCode = (v: unknown) => typeof v === 'string' && /^\d{3,10}$/.test(v)

export const ledgerHandlers = [
  http.get('/api/v1/ledger', ({ request }) => {
    const url = new URL(request.url)
    const data: LedgerReport = {
      from: url.searchParams.get('from') ?? '2026-01-01',
      to: url.searchParams.get('to') ?? '2026-12-31',
      currency: 'CHF',
      balances,
      unposted: [],
    }
    return HttpResponse.json({ data })
  }),
  http.get<{ code: string }>('/api/v1/ledger/accounts/:code', ({ params }) => {
    const found = balances.find((b) => b.account === params.code)
    if (!found) return error(404, 'not_found', 'Not found.')
    const data: LedgerStatement = {
      account: found.account,
      name: found.name,
      currency: found.currency,
      opening: found.opening,
      closing: found.closing,
      lines: [
        {
          date: '2026-03-01',
          ref: 'RE-2026-0001',
          description: 'Invoice',
          contra: '3200',
          debit: found.debit,
          credit: found.credit,
          balance: found.closing,
        },
      ],
    }
    return HttpResponse.json({ data })
  }),
  http.get('/api/v1/ledger/settings', () => HttpResponse.json({ data: accounts })),
  http.put<never, Partial<LedgerAccounts>>('/api/v1/ledger/settings', async ({ request }) => {
    if (request.headers.get('x-test-role') === 'member')
      return error(403, 'forbidden', 'Only an owner or admin can change the accounts.')
    const body = await request.json()
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(body))
      if (key !== 'bank' && !validCode(value)) fields[key] = 'Use 3 to 10 digits.'
    for (const [method, code] of Object.entries(body.bank ?? {}))
      if (!validCode(code)) fields[`bank.${method}`] = 'Use 3 to 10 digits.'
    if (Object.keys(fields).length)
      return error(422, 'validation_failed', 'Check the fields.', { fields })
    accounts = { ...accounts, ...body }
    return HttpResponse.json({ data: accounts })
  }),
]
