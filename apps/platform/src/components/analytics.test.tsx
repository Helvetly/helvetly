import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import ReactGA from 'react-ga4'

import { Analytics } from './analytics'

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

function renderWith(id: string) {
  server.use(
    http.get('/api/v1/auth/config', () =>
      HttpResponse.json({ ...config, google_analytics_id: id }),
    ),
  )
  const initialize = vi.spyOn(ReactGA, 'initialize').mockImplementation(() => {})
  const send = vi.spyOn(ReactGA, 'send').mockImplementation(() => {})
  vi.spyOn(ReactGA, 'set').mockImplementation(() => {})
  const client = new QueryClient()
  const view = render(
    <QueryClientProvider client={client}>
      <Analytics />
    </QueryClientProvider>,
  )
  return { initialize, send, view, client }
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
