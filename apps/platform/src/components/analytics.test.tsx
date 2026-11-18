import { getCsrfToken, setCsrfToken } from '@helvetly/ui/lib/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import ReactGA from 'react-ga4'

import { billingKeys, useBilling, type Billing } from '@/lib/billing'
import { queryKeys, useSession } from '@/lib/queries'

import { Analytics, subscriptionPlan } from './analytics'

const nav = vi.hoisted(() => ({ pathname: '/invoices' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

const config = { google: true, email: true, passkey: true, dev_codes: false }
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})

function renderWith(id: string, session?: unknown, billing?: Partial<Billing>) {
  server.use(
    http.get('/api/v1/auth/config', () =>
      HttpResponse.json({ ...config, google_analytics_id: id }),
    ),
  )
  const initialize = vi.spyOn(ReactGA, 'initialize').mockImplementation(() => {})
  const send = vi.spyOn(ReactGA, 'send').mockImplementation(() => {})
  const set = vi.spyOn(ReactGA, 'set').mockImplementation(() => {})
  const client = new QueryClient()
  if (session) {
    client.setQueryData(queryKeys.session, session)
  }
  if (billing) {
    client.setQueryData(billingKeys.overview, billing)
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Analytics />
    </QueryClientProvider>,
  )
  return { initialize, send, set, view, client }
}

test('sends nothing when the server has no measurement id', async () => {
  const { initialize, send, client } = renderWith('')

  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(initialize).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})

test('sends a page view of the path alone, again on navigation', async () => {
  window.history.replaceState(null, '', '/invoices?code=secret#token')
  nav.pathname = '/invoices'
  const { initialize, send, view, client } = renderWith('G-TEST123')

  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(initialize).toHaveBeenCalledWith('G-TEST123', { gtagOptions: { send_page_view: false } })
  expect(send).toHaveBeenLastCalledWith({
    hitType: 'pageview',
    page: '/invoices',
    location: `${window.location.origin}/invoices`,
    title: 'Helvetly',
  })

  nav.pathname = '/clients'
  view.rerender(
    <QueryClientProvider client={client}>
      <Analytics />
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ page: '/clients' })),
  )
})

test('signed in, events carry the pseudonyms and role, set before the page view', async () => {
  nav.pathname = '/invoices'
  const { send, set } = renderWith(
    'G-TEST123',
    {
      role: 'admin',
      analytics: { user_id: 'a1b2c3', workspace_id: 'd4e5f6' },
    },
    { enabled: true, status: 'active', plan: 'business' },
  )

  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(set).toHaveBeenCalledWith({
    user_id: 'a1b2c3',
    workspace_id: 'd4e5f6',
    workspace_role: 'admin',
    plan: 'business',
  })
  const [firstSet] = set.mock.invocationCallOrder
  const [firstSend] = send.mock.invocationCallOrder
  expect(firstSet).toBeLessThan(firstSend ?? 0)
})

test('signed out, never fetches the session and sends no pseudonyms', async () => {
  const { send, set } = renderWith('G-TEST123')

  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  expect(set).toHaveBeenCalledWith({
    user_id: null,
    workspace_id: null,
    workspace_role: null,
    plan: null,
  })
})

test.each([
  [undefined, null],
  [{ enabled: false, status: '', plan: '' }, null],
  [{ enabled: true, status: 'trialing', plan: 'pro' }, 'trial'],
  [{ enabled: true, status: 'active', plan: 'starter' }, 'starter'],
  [{ enabled: true, status: 'canceled', plan: '' }, 'none'],
] as const)('plan of %o is %s', (billing, plan) => {
  expect(subscriptionPlan(billing as Billing | undefined)).toBe(plan)
})

function Gate() {
  return <span>{useBilling().data?.plan}</span>
}

test('alongside the billing query PlanGate runs, its fetch still has a queryFn', async () => {
  const error = vi.spyOn(console, 'error')
  server.use(
    http.get('/api/v1/billing', () =>
      HttpResponse.json({ data: { enabled: true, status: 'active', plan: 'pro' } }),
    ),
  )
  const { send, set, view, client } = renderWith('G-TEST123', { role: 'owner' })
  view.rerender(
    <QueryClientProvider client={client}>
      <Analytics />
      <Gate />
    </QueryClientProvider>,
  )

  await waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ plan: 'pro' })))
  expect(send).toHaveBeenCalled()
  expect(error).not.toHaveBeenCalledWith(expect.stringContaining('No queryFn'))
})

function SessionUser() {
  return <span>{useSession().data?.role}</span>
}

test('alongside useSession, a later session refetch still keeps the CSRF token', async () => {
  let token = 'first'
  server.use(
    http.get('/api/v1/session', () =>
      HttpResponse.json({ role: 'owner', csrf_token: token, workspace: { id: 'w', name: 'W' } }),
    ),
  )
  const { set, view, client } = renderWith('G-TEST123')
  const tree = (n: number) => (
    <QueryClientProvider client={client}>
      <SessionUser />
      <Analytics key={n} />
    </QueryClientProvider>
  )
  view.rerender(tree(1))
  await waitFor(() => expect(getCsrfToken()).toBe('first'))
  await waitFor(() =>
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ workspace_role: 'owner' })),
  )

  // Analytics renders last, then the session is read again (a workspace switch invalidates it).
  token = 'second'
  view.rerender(tree(2))
  await client.invalidateQueries({ queryKey: queryKeys.session })
  await waitFor(() => expect(getCsrfToken()).toBe('second'))
})
