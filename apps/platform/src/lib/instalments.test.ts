import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'

import { ApiError } from './api'
import { awaitingIssue, instalmentsApi, issuedCount, type Plan } from './instalments'
import { INTERVALS, invoicesApi } from './invoices'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

test('the sample plan has 2 of 6 partials issued', async () => {
  const { data } = await instalmentsApi.get('pln_mock_1')
  expect(data).toMatchObject({ count: 6, status: 'active', interval: 'monthly' })
  expect(issuedCount(data)).toBe(2)
  expect(data.items[2]).toMatchObject({ seq: 3, due_date: '2026-12-01', issue_on: '2026-11-21' })
})

test('plans are listed per client', async () => {
  expect((await instalmentsApi.list('cli_mock_2')).data.map((plan) => plan.id)).toContain(
    'pln_mock_1',
  )
  expect((await instalmentsApi.list('cli_nobody')).data).toEqual([])
})

test('a draft becomes a plan source, which can be paused, resumed and cancelled once', async () => {
  const created = await invoicesApi.createPlan('inv_draft_9', {
    count: 4,
    interval: 'quarterly',
    first_due_date: '2027-01-31',
  })
  const plan: Plan = created.data
  expect(plan).toMatchObject({ source_invoice_id: 'inv_draft_9', lead_days: 10, auto_send: true })
  expect(plan.items.map((item) => item.due_date)).toEqual([
    '2027-01-31',
    '2027-04-30',
    '2027-07-31',
    '2027-10-31',
  ])
  await expect(invoicesApi.createPlan('inv_draft_9', { ...plan })).rejects.toMatchObject({
    status: 409,
    code: 'invalid_state',
  })
  expect((await instalmentsApi.pause(plan.id)).data.status).toBe('paused')
  await expect(instalmentsApi.pause(plan.id)).rejects.toBeInstanceOf(ApiError)
  expect((await instalmentsApi.resume(plan.id)).data.status).toBe('active')
  const cancelled = (await instalmentsApi.cancel(plan.id)).data
  expect(cancelled.status).toBe('cancelled')
  expect(cancelled.items.every((item) => item.status === 'cancelled')).toBe(true)
  await expect(instalmentsApi.resume(plan.id)).rejects.toMatchObject({ status: 409 })
})

test('a plan needs 2–12 instalments and a known interval', async () => {
  await expect(
    invoicesApi.createPlan('inv_draft_10', {
      count: 1,
      interval: INTERVALS[2]?.value ?? 'monthly',
      first_due_date: '2027-01-01',
    }),
  ).rejects.toMatchObject({ status: 422, details: { fields: { count: expect.any(String) } } })
})

const item = (status: 'scheduled' | 'issued', issue_on: string) =>
  ({ seq: 1, due_date: issue_on, issue_on, invoice_id: null, number: null, status }) as const
const plan = (status: Plan['status'], ...items: ReturnType<typeof item>[]) => ({ status, items })

test('a plan awaits the server only while an active plan has a due partial not yet issued', () => {
  const now = '2026-11-17'
  expect(awaitingIssue(plan('active', item('scheduled', '2026-11-17')), now)).toBe(true)
  expect(awaitingIssue(plan('active', item('scheduled', '2026-11-18')), now)).toBe(false)
  expect(awaitingIssue(plan('active', item('issued', '2026-11-01')), now)).toBe(false)
  expect(awaitingIssue(plan('paused', item('scheduled', '2026-11-01')), now)).toBe(false)
})
