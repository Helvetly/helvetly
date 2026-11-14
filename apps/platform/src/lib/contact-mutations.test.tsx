import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import { clientKeys, useContactMutations } from './clients'

afterEach(() => vi.unstubAllGlobals())

test('a refused contact change refetches the client, so an optimistic primary is undone', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: { code: 'forbidden', message: 'No.' } }, { status: 403 }),
    ),
  )
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  // What client-contacts.tsx writes before the request: B shown as primary.
  client.setQueryData(clientKeys.detail('cli_1'), { id: 'cli_1', contacts: [] })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useContactMutations('cli_1'), { wrapper })
  await act(() =>
    result.current.save
      .mutateAsync({ contactId: 'con_b', input: { is_primary: true } })
      .catch(() => {}),
  )
  expect(client.getQueryState(clientKeys.detail('cli_1'))?.isInvalidated).toBe(true)
})
