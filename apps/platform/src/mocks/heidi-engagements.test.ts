import { http, HttpResponse } from 'msw'
import type * as Msw from 'msw'
import { setupServer } from 'msw/node'
import { vi } from 'vitest'

import { readEvents, type HeidiEvent } from '@/lib/heidi'

import { heidiHandlers } from './heidi'
import { parseLogRequest } from './heidi-engagements'

// `bypass` skips every handler, so the test server could not see the engagement calls.
vi.mock('msw', async (original) => ({
  ...(await original<typeof Msw>()),
  bypass: (input: Request) => input,
}))

test.each([
  ['log 2h for Müller: Konjunktiv II', { quantity: '2', client: 'Müller', note: 'Konjunktiv II' }],
  ['Trag 1,5 Stunden für Keller AG ein', { quantity: '1.5', client: 'Keller AG', note: null }],
  ['Trag 2 Stunden für Müller ein: Thema', { quantity: '2', client: 'Müller', note: 'Thema' }],
  ['log 0.25 hours for Müller', { quantity: '0.25', client: 'Müller', note: null }],
  ['hello', null],
  ['how many hours are left for Müller', null],
])('parseLogRequest(%j)', (text, expected) => {
  expect(parseLogRequest(text)).toEqual(expected)
})

const period = (remaining: string) => ({
  id: 'epr_1',
  quantity: '10',
  used: '4',
  remaining,
  ends_on: '2026-12-31',
  uninvoiced_quantity: '0',
})
const engagement = (id: string, number: number, title: string) => ({
  id,
  number,
  title,
  unit: 'hour',
  client: { id: 'cli_1', number: 1, name: 'Müller' },
  current_period: period('6'),
})

let active = [engagement('eng_1', 1, 'German')]
let posted: { csrf: string | null; body: unknown } | null = null
let attention: string | null = null

const server = setupServer(
  ...heidiHandlers,
  http.get('/api/v1/engagements', ({ request }) => {
    const params = new URL(request.url).searchParams
    attention = params.get('attention')
    return HttpResponse.json({ data: active })
  }),
  http.get('/api/v1/session', () => HttpResponse.json({ csrf_token: 'tok' })),
  http.post('/api/v1/engagements/:id/entries', async ({ request }) => {
    posted = { csrf: request.headers.get('X-CSRF-Token'), body: await request.json() }
    return HttpResponse.json({
      data: { entry: { quantity: '2' }, period: period('4') },
    })
  }),
)
beforeAll(() => server.listen())
beforeEach(() => {
  active = [engagement('eng_1', 1, 'German')]
  posted = null
  attention = null
})
afterAll(() => server.close())

async function chat(message: string): Promise<HeidiEvent[]> {
  const form = new FormData()
  form.set('message', message)
  form.set('conversation_id', 'c1')
  const events: HeidiEvent[] = []
  await readEvents(await fetch('/api/v1/heidi/chat', { method: 'POST', body: form }), (e) =>
    events.push(e),
  )
  return events
}
const text = (events: HeidiEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.value] : [])).join('')

test('hours left answers with a table and an open action', async () => {
  const events = await chat('How many hours are left for Müller?')
  expect(text(events)).toContain('| **German** | Müller | 4 h of 10 h | 6 h |')
  expect(events).toContainEqual({
    type: 'actions',
    actions: [{ id: 'open_engagement', engagement_id: 'eng_1', label: 'Open German' }],
  })
})

test('what needs invoicing asks for attention=to_invoice', async () => {
  await chat('What needs invoicing?')
  expect(attention).toBe('to_invoice')
})

test('one active engagement: confirmation, then the entry is posted with the CSRF token', async () => {
  const events = await chat('log 2h for Müller: Konjunktiv II')
  const confirmation = events.find((e) => e.type === 'confirmation')
  expect(confirmation?.type).toBe('confirmation')
  expect(posted).toBeNull()
  const response = await fetch('/api/v1/heidi/chat/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: 'c1',
      confirmation_id: confirmation?.type === 'confirmation' ? confirmation.id : '',
      approved: true,
    }),
  })
  const after: HeidiEvent[] = []
  await readEvents(response, (e) => after.push(e))
  expect(posted).toEqual({ csrf: 'tok', body: { quantity: '2', note: 'Konjunktiv II' } })
  expect(text(after)).toContain('**4 h** left')
})

test('several active engagements: a choice form', async () => {
  active = [engagement('eng_1', 1, 'German'), engagement('eng_2', 2, 'French')]
  const form = (await chat('log 1h for Müller')).find((e) => e.type === 'form')
  expect(form?.type === 'form' && form.form.fields[0]).toMatchObject({
    options: ['German (#1)', 'French (#2)'],
  })
})

test('no active engagement: helpful text, no write', async () => {
  active = []
  const events = await chat('log 1h for Nobody')
  expect(text(events)).toContain('Create one under **Engagements**')
  expect(events.some((e) => e.type === 'confirmation')).toBe(false)
})

test('a unit the engagement does not track is not logged', async () => {
  active = [{ ...engagement('eng_1', 1, 'German'), unit: 'day' }]
  const events = await chat('log 2h for Müller')
  expect(text(events)).toContain('“German” is tracked in days. How many days should I log?')
  expect(events.some((e) => e.type === 'confirmation')).toBe(false)
})

test('no unit uses the engagement unit', async () => {
  expect((await chat('log 2 for Müller')).some((e) => e.type === 'confirmation')).toBe(true)
})
