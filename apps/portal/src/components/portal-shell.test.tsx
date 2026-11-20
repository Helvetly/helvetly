import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { portalHandlers, portalSession } from '@/mocks/portal'

import { PortalShell } from './portal-shell'

const replace = vi.fn<(to: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn<() => void>() }),
  usePathname: () => '/',
}))

const server = setupServer(...portalHandlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  replace.mockClear()
})
afterAll(() => server.close())

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <PortalShell>
          <p>Page</p>
        </PortalShell>
      </TooltipProvider>
    </QueryClientProvider>,
  )

test('without a session it goes to the portal sign-in', async () => {
  server.use(
    http.get('/api/v1/public/portal/session', () =>
      HttpResponse.json({ error: { code: 'unauthenticated', message: 'x' } }, { status: 401 }),
    ),
  )
  show()
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
})

test('names the supplier once in the header, and the account button shows no email', async () => {
  show()
  const header = (await screen.findByRole('navigation', { name: 'Portal' })).closest('header')
  expect(header?.textContent?.split(portalSession.workspace.name)).toHaveLength(2)
  const account = screen.getByRole('button', { name: /^Account menu/ })
  expect(account.textContent).not.toContain(portalSession.email)
})

const openAccountMenu = async () => {
  const trigger = await screen.findByRole('button', { name: /^Account menu/ })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  return screen.findByRole('menu')
}

test('shows the nav with the current page marked, and Profile in the account menu', async () => {
  show()
  expect(await screen.findByText('Page')).toBeTruthy()
  for (const name of ['Overview', 'Invoices', 'Quotes', 'Engagements', 'Documents'])
    expect(screen.getByRole('link', { name })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('link', { name: 'Invoices' }).getAttribute('aria-current')).toBeNull()
  const menu = await openAccountMenu()
  expect(within(menu).getByText(portalSession.email)).toBeTruthy()
  expect(within(menu).getByRole('menuitem', { name: 'Profile' }).getAttribute('href')).toBe(
    '/profile',
  )
  expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
  expect(within(menu).queryByText('Switch client')).toBeNull()
  expect(within(menu).getByRole('group', { name: 'Theme' })).toBeTruthy()
})

test('offers the clients to switch to in the account menu, with a foreign workspace named', async () => {
  server.use(
    http.get('/api/v1/public/portal/session', () =>
      HttpResponse.json({
        ...portalSession,
        clients: [
          ...portalSession.clients,
          { id: 'cli_2', name: 'Other AG', workspace_name: 'Muster GmbH' },
          { id: 'cli_3', name: 'Third AG', workspace_name: 'Beispiel AG' },
        ],
      }),
    ),
  )
  show()
  const menu = await openAccountMenu()
  const theme = within(menu).getByRole('group', { name: 'Theme' })
  const radios = within(menu)
    .getAllByRole('menuitemradio')
    .filter((radio) => !theme.contains(radio))
  expect(radios.map((r) => r.textContent)).toEqual(['Keller AG', 'Other AG', 'Third AGBeispiel AG'])
  expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
})

test('switching client clears the cache and goes to the overview', async () => {
  server.use(
    http.get('/api/v1/public/portal/session', () =>
      HttpResponse.json({
        ...portalSession,
        clients: [
          ...portalSession.clients,
          { id: 'cli_2', name: 'Other AG', workspace_name: 'Muster GmbH' },
        ],
      }),
    ),
  )
  show()
  const menu = await openAccountMenu()
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Other AG' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
})

test('after switching client on the overview, the shell shows the new client', async () => {
  let current = portalSession.client
  const other = { id: 'cli_2', name: 'Other AG', workspace_name: 'Muster GmbH' }
  server.use(
    http.get('/api/v1/public/portal/session', () =>
      HttpResponse.json({
        ...portalSession,
        client: current,
        clients: [...portalSession.clients, other],
      }),
    ),
    http.post('/api/v1/public/portal/session/client', () => {
      current = { id: other.id, name: other.name }
      return HttpResponse.json({ csrf_token: 'new' })
    }),
  )
  show()
  const menu = await openAccountMenu()
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Other AG' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  // usePathname stays '/', so nothing re-renders the shell unless the cache tells it to.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Account menu/ }).textContent).toContain('Other AG'),
  )
})

test('the header shows its shadow only while the page is scrolled', async () => {
  show()
  const header = (await screen.findByRole('navigation', { name: 'Portal' })).closest('header')
  expect(header?.hasAttribute('data-scrolled')).toBe(false)
  window.scrollY = 120
  fireEvent.scroll(window)
  expect(header?.hasAttribute('data-scrolled')).toBe(true)
  window.scrollY = 0
  fireEvent.scroll(window)
  expect(header?.hasAttribute('data-scrolled')).toBe(false)
})
