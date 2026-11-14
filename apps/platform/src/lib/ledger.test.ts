import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'

import {
  fetchLedger,
  fetchLedgerSettings,
  fetchStatement,
  ledgerExportUrl,
  saveLedgerSettings,
} from './ledger'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('fetchLedger returns the sample balances', async () => {
  const report = await fetchLedger('2026-01-01', '2026-12-31')
  expect(report.balances.find((b) => b.account === '3200')?.closing).toBe('-1000.00')
  expect(report.balances.find((b) => b.account === '1000')?.closing).toBe('1081.00')
})

test('fetchStatement returns one account', async () => {
  const s = await fetchStatement('2200', 'CHF', '2026-01-01', '2026-12-31')
  expect(s.closing).toBe('-81.00')
})

test('saving rejects a bad code and a member', async () => {
  const accounts = await fetchLedgerSettings()
  await expect(saveLedgerSettings({ ...accounts, revenue: '12' })).rejects.toThrow(
    'Check the fields.',
  )
  expect((await saveLedgerSettings(accounts)).revenue).toBe('3200')
  server.use(
    http.put('/api/v1/ledger/settings', () =>
      HttpResponse.json({ error: { code: 'forbidden', message: 'Not allowed.' } }, { status: 403 }),
    ),
  )
  await expect(saveLedgerSettings(accounts)).rejects.toThrow('Not allowed.')
})

test('export goes through a plain link', () => {
  expect(ledgerExportUrl('banana', '2026-01-01', '2026-12-31')).toBe(
    '/api/v1/ledger/export?from=2026-01-01&to=2026-12-31&format=banana',
  )
})
