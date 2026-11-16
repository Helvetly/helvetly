import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import { affectedQueries, RESUME_MS, useHeidiChat } from './use-heidi'

const transcript = [
  { id: 'm1', role: 'user', text: 'Which invoices are overdue?' },
  {
    id: 'm2',
    role: 'assistant',
    text: 'Three are overdue.',
    created_at: '2026-11-11T08:31:00Z',
    actions: [{ id: 'list_overdue_invoices', label: 'Show them' }],
    records: [{ kind: 'client', id: 'c1', title: 'John', status: 'active' }],
  },
]
const server = setupServer(
  http.get('/api/v1/heidi/conversations/:id', ({ params }) =>
    params.id === 'conv1'
      ? HttpResponse.json({ data: transcript })
      : HttpResponse.json({ error: { code: 'not_found', message: 'Gone.' } }, { status: 404 }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  localStorage.clear()
  server.resetHandlers()
})
afterAll(() => server.close())

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

const store = (minutesAgo: number) =>
  localStorage.setItem(
    'helvetly:heidi:conversation:user:workspace',
    JSON.stringify({ id: 'conv1', at: Date.now() - minutesAgo * 60_000 }),
  )

test('resumes a conversation used within five minutes, with its actions and records', async () => {
  store(4)
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })

  await waitFor(() => expect(result.current.restoring).toBe(false))
  expect(result.current.conversationId).toBe('conv1')
  expect(result.current.messages.map((message) => message.text)).toEqual([
    'Which invoices are overdue?',
    'Three are overdue.',
  ])
  expect(result.current.messages[1]?.actions).toEqual([
    { id: 'list_overdue_invoices', label: 'Show them' },
  ])
  expect(result.current.messages[1]?.records).toEqual([
    { kind: 'client', id: 'c1', title: 'John', status: 'active' },
  ])
  expect(result.current.messages[1]?.at?.toISOString()).toBe('2026-11-11T08:31:00.000Z')
  expect(result.current.messages[0]?.at).toBeUndefined()
})

test('starts over after five minutes', async () => {
  store(RESUME_MS / 60_000 + 1)
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })

  await waitFor(() => expect(result.current.restoring).toBe(false))
  expect(result.current.conversationId).not.toBe('conv1')
  expect(result.current.messages).toEqual([])
})

test('opens an older conversation from the history and remembers it', async () => {
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  act(() => result.current.open('conv1'))

  await waitFor(() => expect(result.current.messages).toHaveLength(2))
  expect(result.current.conversationId).toBe('conv1')
  expect(result.current.restoring).toBe(false)
  expect(localStorage.getItem('helvetly:heidi:conversation:user:workspace')).toContain('conv1')
})

test('a conversation that is gone from the history starts a fresh chat', async () => {
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  act(() => result.current.open('gone'))

  await waitFor(() => expect(result.current.conversationId).not.toBe('gone'))
  expect(result.current.restoring).toBe(false)
  expect(result.current.messages).toEqual([])
})

test('only writes refetch, and only what they touched', () => {
  expect(affectedQueries(['Looking up overdue invoices'])).toEqual([])
  expect(affectedQueries(['Finding the client', 'Deleting the client'])).toEqual([['clients']])
  expect(affectedQueries(['Sending the invoice'])).toEqual([['invoices'], ['dashboard']])
  expect(affectedQueries(['Recorded engagement entry'])).toEqual([['engagements']])
})

test('restores a pending confirmation so reloading does not strand the turn', async () => {
  store(1)
  server.use(
    http.get('/api/v1/heidi/conversations/:id', () =>
      HttpResponse.json({
        data: [
          ...transcript.slice(0, 1),
          {
            ...transcript[1],
            confirmation: {
              type: 'confirmation',
              id: 'cnf_pending',
              title: 'Log work?',
              body: 'Record two hours.',
              confirm_label: 'Log it',
              tone: 'default',
            },
          },
        ],
      }),
    ),
  )
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  await waitFor(() => expect(result.current.restoring).toBe(false))
  expect(result.current.confirmation?.id).toBe('cnf_pending')
  expect(result.current.messages[1]?.state).toBe('paused')
})

test('rapid send submits one message while the first request is starting', async () => {
  let calls = 0
  server.use(
    http.post('/api/v1/heidi/chat', async () => {
      calls++
      await delay(50)
      return new HttpResponse(
        'data: {"type":"text","value":"Answer"}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }),
  )
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  await act(async () => {
    // The second send waits on nothing: the first is already in flight.
    await Promise.all([result.current.send('Question'), result.current.send('Question')])
  })
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(calls).toBe(1)
})

test('an off-topic refusal is an ordinary answer with its actions', async () => {
  const refusal =
    'I can only help with Helvetly and your business: invoices, clients, expenses, VAT and the like. Try asking:\n\n- Which invoices are overdue?'
  server.use(
    http.post(
      '/api/v1/heidi/chat',
      () =>
        new HttpResponse(
          `data: ${JSON.stringify({ type: 'text', value: refusal })}\n\ndata: {"type":"actions","actions":[{"id":"list_overdue_invoices","label":"Show overdue invoices"}]}\n\ndata: {"type":"done","usage":{"tokens":0}}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    ),
  )
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  await act(() => result.current.send('Write C++ code for Fibonacci'))
  await waitFor(() => expect(result.current.busy).toBe(false))
  const answer = result.current.messages[1]
  expect(answer?.role).toBe('assistant')
  expect(answer?.text).toBe(refusal)
  expect(answer?.actions).toEqual([{ id: 'list_overdue_invoices', label: 'Show overdue invoices' }])
})

test('the chat is the same object until something it uses changes', async () => {
  // One client for every render: the shared wrapper makes a new one each time.
  const client = new QueryClient()
  const fixed = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  let page = ''
  let path = ''
  window.history.pushState({}, '', '/settings/periods/')
  server.use(
    http.post('/api/v1/heidi/chat', async ({ request }) => {
      const form = await request.formData()
      page = String(form.get('page'))
      path = String(form.get('path'))
      return new HttpResponse('data: {"type":"done","usage":{"tokens":0}}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }),
  )
  const { result, rerender } = renderHook(
    ({ on }: { on: 'invoices' | 'clients' }) => useHeidiChat(on, 'user:workspace'),
    { wrapper: fixed, initialProps: { on: 'invoices' } },
  )
  const first = result.current

  rerender({ on: 'invoices' })
  expect(result.current).toBe(first)
  expect(result.current.send).toBe(first.send)

  rerender({ on: 'clients' })
  expect(result.current).not.toBe(first)
  expect(result.current.send).not.toBe(first.send)
  expect(result.current.stop).toBe(first.stop)
  await act(() => result.current.send('Question'))
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(page).toBe('clients')
  // The screen the question is asked from goes along, so "what is this page?" has an answer.
  expect(path).toBe('/settings/periods/')
  window.history.pushState({}, '', '/')
})

test('a different workspace does not restore the previous workspace transcript', async () => {
  store(1)
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:other-workspace'), { wrapper })
  expect(result.current.restoring).toBe(false)
  expect(result.current.messages).toEqual([])
  expect(result.current.conversationId).not.toBe('conv1')
})

const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`

test('keeps the steps of a turn and how long it took', async () => {
  server.use(
    http.post('/api/v1/heidi/chat', async () => {
      await delay(30)
      return new HttpResponse(
        frame({ type: 'status', label: 'Checking the question' }) +
          frame({ type: 'status', label: 'Writing the answer' }) +
          frame({ type: 'text', value: 'Three are overdue.' }) +
          frame({ type: 'done', usage: { tokens: 5 } }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }),
  )
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  await act(() => result.current.send('Summarize my receivables'))
  await waitFor(() => expect(result.current.messages[1]?.startedAt).toBeTypeOf('number'))
  await waitFor(() => expect(result.current.busy).toBe(false))
  const answer = result.current.messages[1]
  expect(answer?.steps).toEqual(['Checking the question', 'Writing the answer'])
  expect(answer?.status).toBeUndefined()
  expect(answer?.startedAt).toBeUndefined()
  expect(answer?.workedMs).toBeGreaterThanOrEqual(25)
})
