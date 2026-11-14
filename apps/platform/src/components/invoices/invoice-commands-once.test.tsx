import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import { listItem, sampleInvoice } from '@/test/invoice-api'

import { useInvoiceCommands } from './invoice-commands'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<(href: string) => void>(), replace: vi.fn<() => void>() }),
}))

// Each POST makes a new draft on the server, so a second click while the first is out would make two.
const posts: string[] = []
const release = { current: Promise.withResolvers<void>() }
const server = setupServer(
  http.post<{ id: string; action: string }>('/api/v1/invoices/:id/:action', async ({ params }) => {
    posts.push(params.action)
    await release.current.promise
    return HttpResponse.json(
      { data: sampleInvoice({ id: `inv_${posts.length}`, status: 'draft' }) },
      { status: 201 },
    )
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  posts.length = 0
  release.current = Promise.withResolvers<void>()
})
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)
const invoice = listItem(sampleInvoice({ status: 'open' }))

test('a second Duplicate while the first is out makes no second draft', async () => {
  const { result } = renderHook(() => useInvoiceCommands(vi.fn<(id: string) => void>()), {
    wrapper,
  })
  act(() => {
    result.current.run('duplicate', invoice)
    result.current.run('duplicate', invoice)
  })
  await vi.waitFor(() => expect(posts).toEqual(['duplicate']))
  act(() => result.current.run('duplicate', invoice))
  release.current.resolve()
  await vi.waitFor(() => expect(result.current.busy).toBe(false))
  expect(posts).toEqual(['duplicate'])
})

function Harness() {
  const commands = useInvoiceCommands(vi.fn<(id: string) => void>())
  return (
    <>
      <button type="button" onClick={() => commands.run('credit_note', invoice)}>
        Credit
      </button>
      {commands.dialogs}
    </>
  )
}

test('confirming Credit note again while the first is out makes no second draft', async () => {
  render(<Harness />, { wrapper })
  for (let i = 0; i < 2; i++) {
    await userEvent.click(screen.getByRole('button', { name: 'Credit' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Create credit note' }))
  }
  await vi.waitFor(() => expect(posts.length).toBeGreaterThan(0))
  release.current.resolve()
  await vi.waitFor(() => expect(posts).toEqual(['credit-note']))
})
