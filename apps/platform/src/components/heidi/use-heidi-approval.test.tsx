import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import { useHeidiChat } from './use-heidi'

const ensure = vi.fn<() => Promise<boolean>>()
vi.mock('@/components/ai/ai-approval', () => ({ useAIApproval: () => ({ ensure }) }))

let chats = 0
let uploads = 0
const server = setupServer(
  http.post('/api/v1/heidi/chat', () => {
    chats++
    return new HttpResponse('data: {"type":"done","usage":{"tokens":0}}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }),
  http.post('/api/v1/imports', () => {
    uploads++
    return HttpResponse.json({ data: { id: 'imp_1' } }, { status: 201 })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  chats = uploads = 0
  ensure.mockReset()
  server.resetHandlers()
})
afterAll(() => server.close())

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

test('Not now sends nothing, uploads nothing and adds no message, so the composer keeps the draft', async () => {
  ensure.mockResolvedValue(false)
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  const file = new File(['%PDF-1.7'], 'invoice.pdf', { type: 'application/pdf' })
  let sent: boolean | undefined
  await act(async () => {
    sent = await result.current.send('Import this invoice', [file])
  })
  expect(sent).toBe(false)
  expect(result.current.messages).toEqual([])
  expect(chats + uploads).toBe(0)
})

test('approval sends the message once', async () => {
  ensure.mockResolvedValue(true)
  const { result } = renderHook(() => useHeidiChat('invoices', 'user:workspace'), { wrapper })
  let sent: boolean | undefined
  await act(async () => {
    sent = await result.current.send('Explain this term')
  })
  expect(sent).toBe(true)
  await vi.waitFor(() => expect(chats).toBe(1))
  expect(ensure).toHaveBeenCalledTimes(1)
})
