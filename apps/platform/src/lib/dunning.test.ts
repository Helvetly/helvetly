import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'

import { dunningApi, dunningSummary, noticePdfUrl, type Dunning } from './dunning'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

const base: Dunning = {
  applies: true,
  enabled: true,
  client_enabled: true,
  paused: false,
  next: { level: 2, levels: 3, title: '2. Mahnung', due_on: '2026-12-29' },
  notices: [],
}

test.each<[string, Partial<Dunning>, string]>([
  ['the next level and its day', {}, '2. Mahnung goes out on 29 Dec 2026.'],
  ['paused', { paused: true }, 'Paused: no reminder goes out until you resume.'],
  [
    'client left out',
    { client_enabled: false },
    'This client gets no reminders; you can send by hand.',
  ],
  [
    'dunning off',
    { enabled: false },
    'Dunning is off in the invoice settings; you can send by hand.',
  ],
  ['nothing due', { next: null }, 'Nothing is due.'],
  ['instalments', { applies: false }, 'Reminders follow the instalments of this invoice.'],
])('summary: %s', (_, change, text) => {
  expect(dunningSummary({ ...base, ...change })).toBe(text)
})

test('the letter of a notice opens from the API', () => {
  expect(noticePdfUrl('inv/1', 2)).toBe('/api/v1/invoices/inv%2F1/dunning/2/pdf')
})

test('sending moves to the next level, pausing and resuming flip the pause', async () => {
  const first = (await dunningApi.get('inv_lib')).data
  expect(first.next?.level).toBe(1)
  const sent = (await dunningApi.run('inv_lib', 'send')).data
  expect(sent.notices.map((notice) => notice.title)).toEqual(['Zahlungserinnerung'])
  expect(sent.next).toMatchObject({ level: 2, title: '2. Mahnung' })
  expect((await dunningApi.run('inv_lib', 'pause')).data.paused).toBe(true)
  expect((await dunningApi.run('inv_lib', 'resume')).data.paused).toBe(false)
})
