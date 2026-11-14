import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createElement, type ReactNode } from 'react'

import { getCsrfToken, setCsrfToken } from './api'
import { assignableRoles, canManage, useInvite, useSwitchWorkspace } from './members'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const client = new QueryClient()
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children)

test.each([
  ['owner', 'owner', ['owner', 'admin', 'member']],
  ['owner', 'member', ['owner', 'admin', 'member']],
  ['admin', 'owner', []],
  ['admin', 'admin', ['admin', 'member']],
  ['admin', 'member', ['admin', 'member']],
  ['member', 'member', []],
  ['member', 'owner', []],
] as const)('%s changing a %s may assign %j', (actor, target, expected) => {
  expect(assignableRoles(actor, target)).toEqual(expected)
})

test('only owners and admins manage', () => {
  expect(['owner', 'admin', 'member'].map(canManage)).toEqual([true, true, false])
})

test('switching workspace keeps the new CSRF token and clears the cache', async () => {
  setCsrfToken('old')
  client.setQueryData(['x'], 1)
  server.use(
    http.post('/api/v1/session/workspace', async ({ request }) => {
      expect(await request.json()).toEqual({ workspace_id: 'ws_2' })
      return HttpResponse.json({ csrf_token: 'new' })
    }),
  )
  const { result } = renderHook(() => useSwitchWorkspace(), { wrapper })
  await act(() => result.current.mutateAsync('ws_2'))
  expect(getCsrfToken()).toBe('new')
  expect(client.getQueryData(['x'])).toBeUndefined()
})

test('a page already on screen shows the new workspace after a switch, not the old one', async () => {
  let workspace = 'A'
  server.use(
    http.get('/api/v1/figures', () => HttpResponse.json({ workspace })),
    http.post('/api/v1/session/workspace', () => {
      workspace = 'B'
      return HttpResponse.json({ csrf_token: 'new' })
    }),
  )
  // Mounted on its own, like the dashboard when the switch happens on '/' (no route change).
  const page = renderHook(
    () =>
      useQuery({
        queryKey: ['figures'],
        queryFn: () => fetch('/api/v1/figures').then((res) => res.json()),
      }),
    { wrapper },
  )
  await waitFor(() => expect(page.result.current.data).toEqual({ workspace: 'A' }))
  const { result } = renderHook(() => useSwitchWorkspace(), { wrapper })
  await act(() => result.current.mutateAsync('ws_2'))
  await waitFor(() => expect(page.result.current.data).toEqual({ workspace: 'B' }))
  page.unmount()
})

test('inviting posts email and role', async () => {
  let body: unknown
  const created = {
    id: 'inv_1',
    email: 'a@b.ch',
    role: 'member',
    invited_by: 'Me',
    created_at: '',
    expires_at: '',
    url: 'u',
    email_sent: true,
  }
  server.use(
    http.post('/api/v1/members/invitations', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ data: created }, { status: 201 })
    }),
  )
  const { result } = renderHook(() => useInvite(), { wrapper })
  await act(() => result.current.mutateAsync({ email: 'a@b.ch', role: 'member', send_email: true }))
  await waitFor(() => expect(result.current.data).toEqual(created))
  expect(body).toEqual({ email: 'a@b.ch', role: 'member', send_email: true })
})
