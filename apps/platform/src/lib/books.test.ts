import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'

import { booksApi, EVENT_LABELS, exportUrl } from './books'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

test('closed months are listed newest first, closed once and reopened', async () => {
  expect((await booksApi.periods()).data.map((period) => period.month)).toEqual([
    '2026-10',
    '2026-09',
  ])
  await expect(booksApi.close('2026-10')).rejects.toMatchObject({ status: 409, code: 'conflict' })
  await expect(booksApi.close('2026-13')).rejects.toMatchObject({ status: 422 })
  await expect(booksApi.close('2999-01')).rejects.toMatchObject({ status: 422 })
  expect((await booksApi.close('2026-08')).data.month).toBe('2026-08')
  expect((await booksApi.periods()).data[2]?.month).toBe('2026-08')
  expect((await booksApi.reopen('2026-08')).data).toEqual({ month: '2026-08' })
  await expect(booksApi.reopen('2026-08')).rejects.toMatchObject({ status: 404 })
})

test('the audit log pages by cursor through the events and verifies', async () => {
  const first = await booksApi.events(null, 15)
  expect(first.data.map((event) => event.seq)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  expect(first.meta.next_cursor).toBe('15')
  const rest = await booksApi.events(first.meta.next_cursor)
  expect(rest.data.map((event) => event.seq)).toEqual([16, 17, 18, 19])
  expect(rest.meta.next_cursor).toBeNull()
  expect(rest.data[0]?.prev_hash).toBe(first.data[14]?.hash)
  expect(first.data.every((event) => event.kind in EVENT_LABELS)).toBe(true)
  expect((await booksApi.verify()).data).toEqual({ ok: true, broken_at: null, entries: 19 })
  await expect(booksApi.events('x')).rejects.toMatchObject({ status: 400 })
})

test('the audit log reads newest first and narrows by type, person and text', async () => {
  const newest = await booksApi.events(null, 2, { order: 'newest' })
  expect(newest.data.map((event) => event.seq)).toEqual([19, 18])
  const older = await booksApi.events(newest.meta.next_cursor, 2, { order: 'newest' })
  expect(older.data.map((event) => event.seq)).toEqual([17, 16])
  const payments = await booksApi.events(null, 50, { category: 'payments' })
  expect(payments.data.map((event) => event.kind)).toEqual(['payment.added', 'refund.added'])
  const marco = await booksApi.events(null, 50, { actor: 'usr_mock_2', q: 'papeterie' })
  expect(marco.data.map((event) => event.kind)).toEqual(['expense.booked'])
  expect((await booksApi.people()).data.map((person) => person.name)).toEqual([
    'Anna Muster',
    'Marco Bernasconi',
  ])
})

test('the export is a CSV of the chain', async () => {
  const res = await fetch(new URL(exportUrl(), location.href))
  expect(res.headers.get('content-type')).toContain('text/csv')
  const rows = (await res.text()).trim().split('\n')
  expect(rows[0]).toContain('seq,at,kind,subject_type,subject_id,actor,payload,prev_hash,hash')
  expect(rows).toHaveLength(20)
})

test('agreements: every client starts with one; new ones can be deleted before use', async () => {
  const [sample] = (await booksApi.agreements('cli_1')).data
  expect(sample).toMatchObject({ id: 'sba_mock_1', client_id: 'cli_1', ends_on: null })
  await expect(
    booksApi.createAgreement('cli_1', { starts_on: '2027-01-01', ends_on: '2026-01-01' }),
  ).rejects.toMatchObject({ status: 422, details: { fields: { ends_on: expect.any(String) } } })
  const created = (await booksApi.createAgreement('cli_1', { starts_on: '2027-01-01' })).data
  expect((await booksApi.agreements('cli_1')).data[0]?.id).toBe(created.id)
  await booksApi.deleteAgreement('cli_1', created.id)
  expect((await booksApi.agreements('cli_1')).data).toHaveLength(1)
  await expect(booksApi.deleteAgreement('cli_1', 'sba_nope')).rejects.toMatchObject({
    status: 404,
  })
})
