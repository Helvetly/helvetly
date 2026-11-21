import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Session } from '@/lib/api'

import { AppSidebar } from './app-sidebar'

const replace = vi.fn<(href: string) => void>()
const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/',
}))

const session: Session = {
  user: { id: 'u1', email: 'anna@example.com', name: 'Anna', avatar_url: null },
  workspace: { id: 'w1', name: 'Muster GmbH' },
  role: 'owner',
  onboarded: true,
  csrf_token: 't',
}

let switchedTo: unknown
let created: unknown
const server = setupServer(
  http.get('/api/v1/session/workspaces', () =>
    HttpResponse.json({
      data: [
        { id: 'w1', name: 'Muster GmbH', role: 'owner', current: true, plan: 'business' },
        { id: 'w2', name: 'Other AG', role: 'member', current: false, plan: 'pro' },
        { id: 'w3', name: 'Frozen AG', role: 'admin', current: false, plan: '' },
        { id: 'w4', name: 'Unbilled AG', role: 'owner', current: false, plan: null },
      ],
    }),
  ),
  http.post('/api/v1/session/workspace', async ({ request }) => {
    switchedTo = await request.json()
    return HttpResponse.json({ csrf_token: 'n' })
  }),
  http.post('/api/v1/workspaces', async ({ request }) => {
    created = await request.json()
    return HttpResponse.json({ csrf_token: 'c' })
  }),
  http.all('*', () => new HttpResponse(null, { status: 404 })),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const renderSidebar = (current: Session = session) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider keyboardShortcut={false}>
          <AppSidebar session={current} />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

test('choosing another workspace switches the session and goes to the dashboard', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar session={session} />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: /Muster GmbH/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Other AG/ }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  expect(switchedTo).toEqual({ workspace_id: 'w2' })
})

test('the workspace menu adds a workspace and lands on its welcome', async () => {
  renderSidebar()
  await userEvent.click(screen.getByRole('button', { name: /Muster GmbH/ }))
  expect(screen.queryByRole('menuitem', { name: /Members/ })).not.toBeInTheDocument()
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Add workspace' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add workspace' })
  await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
  expect(dialog).toHaveTextContent('Give the workspace a name')
  await userEvent.type(screen.getByLabelText(/^Name/), '  Side AG ')
  await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/welcome'))
  expect(created).toMatchObject({ name: 'Side AG' })
})

test('Help & feedback lives in the user menu only, and opens its dialog', async () => {
  renderSidebar()
  expect(screen.queryByRole('button', { name: 'Help & feedback' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Account settings' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Anna/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Help & feedback' }))
  expect(await screen.findByRole('dialog', { name: 'Help & feedback' })).toBeInTheDocument()
})

test('the user menu shows the role at the right, without the workspace name', async () => {
  renderSidebar()
  await userEvent.click(screen.getByRole('button', { name: /Anna/ }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('Owner')).toBeInTheDocument()
  expect(menu).not.toHaveTextContent('Muster GmbH')
  expect(within(menu).getAllByRole('separator')).toHaveLength(3)
})

test('a truncated name or email stays readable in full on hover', async () => {
  renderSidebar()
  await userEvent.click(screen.getByRole('button', { name: /Anna/ }))
  const menu = await screen.findByRole('menu')
  const names = screen.getAllByTitle(session.user.name)
  expect(names).toHaveLength(2)
  expect(names.some((name) => menu.contains(name))).toBe(true)
  expect(within(menu).getByTitle(session.user.email)).toBeInTheDocument()
})

test('a long email gets the full width: the role badge shares the name row and the email is small', async () => {
  renderSidebar({
    ...session,
    user: { ...session.user, name: 'Renata Giannini', email: 'info@deindeutschcoach.ch' },
  })
  await userEvent.click(screen.getByRole('button', { name: /Renata/ }))
  const menu = await screen.findByRole('menu')
  const email = within(menu).getByTitle('info@deindeutschcoach.ch')
  expect(email).toHaveClass('text-xs', 'truncate')
  const nameRow = within(menu).getByTitle('Renata Giannini').parentElement
  expect(nameRow).toContainElement(within(menu).getByText('Owner'))
  expect(nameRow).not.toContainElement(email)
})

test('the user menu lists Keyboard shortcuts with its key, and opens the dialog', async () => {
  renderSidebar()
  await userEvent.click(screen.getByRole('button', { name: /Anna/ }))
  const item = await screen.findByRole('menuitem', { name: 'Keyboard shortcuts' })
  expect(item).toHaveTextContent('?')
  expect(await screen.findByRole('menuitem', { name: 'Help & feedback' })).toHaveTextContent('H')
  await userEvent.click(item)
  expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
})

test('? opens the shortcuts dialog and H opens Help & feedback', async () => {
  renderSidebar()
  await userEvent.keyboard('?')
  expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await userEvent.keyboard('h')
  expect(await screen.findByRole('dialog', { name: 'Help & feedback' })).toBeInTheDocument()
})

test('⌘B / Ctrl+B toggles the sidebar and G then N goes to Notifications', async () => {
  const { container } = renderSidebar()
  const sidebar = () => container.querySelector('[data-slot="sidebar"][data-state]')
  expect(sidebar()).toHaveAttribute('data-state', 'expanded')
  await userEvent.keyboard('{Control>}b{/Control}')
  expect(sidebar()).toHaveAttribute('data-state', 'collapsed')
  await userEvent.keyboard('gn')
  expect(push).toHaveBeenCalledWith('/notifications')
})

test('the workspace switcher shows the plan, not the role, and the trial card sits above the user', async () => {
  server.use(
    http.get('/api/v1/billing', () =>
      HttpResponse.json({
        data: billingFixture({
          locked: false,
          plan: 'basic',
          status: 'trialing',
          can_manage: true,
          trial_end: new Date(Date.now() + 2.5 * 86_400_000).toISOString(),
        }),
      }),
    ),
  )
  renderSidebar()
  await waitFor(() =>
    expect(screen.getByTestId('workspace-plan')).toHaveTextContent('Basic · Trial'),
  )
  expect(screen.getByRole('region', { name: 'Plan' })).toHaveTextContent('Trial · 3 days left')
  expect(screen.getByRole('button', { name: /Anna/ })).toHaveTextContent(session.user.email)
})

test('without billing the switcher shows no plan and never the role', () => {
  renderSidebar()
  expect(screen.queryByTestId('workspace-plan')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Muster GmbH/ })).not.toHaveTextContent('Owner')
  expect(screen.queryByRole('region', { name: 'Plan' })).not.toBeInTheDocument()
})

const rowOf = async (name: RegExp) => within(await screen.findByRole('menuitem', { name }))

test('each workspace row shows its own plan, never a role', async () => {
  server.use(
    http.get('/api/v1/billing', () =>
      HttpResponse.json({ data: billingFixture({ enabled: true, locked: false }) }),
    ),
  )
  renderSidebar()
  await waitFor(() => expect(screen.getByTestId('workspace-plan')).toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: /Muster GmbH/ }))
  expect((await rowOf(/Muster GmbH/)).getByText('Business')).toBeInTheDocument()
  expect((await rowOf(/Other AG/)).getByText('Pro')).toBeInTheDocument()
  expect((await rowOf(/Frozen AG/)).getByText('No plan · Read-only')).toBeInTheDocument()
  const unbilled = await screen.findByRole('menuitem', { name: /Unbilled AG/ })
  expect(unbilled.textContent).toBe('UUnbilled AG') // the mark's initial and the name, no plan line
  const menu = await screen.findByRole('menu')
  for (const role of ['Owner', 'Admin', 'Member']) expect(menu).not.toHaveTextContent(role)
})

test('with billing off, rows show no plan even when the list carries one', async () => {
  server.use(
    http.get('/api/v1/billing', () =>
      HttpResponse.json({ data: billingFixture({ enabled: false }) }),
    ),
  )
  renderSidebar()
  await userEvent.click(screen.getByRole('button', { name: /Muster GmbH/ }))
  const menu = await screen.findByRole('menu')
  await screen.findByRole('menuitem', { name: /Other AG/ })
  for (const text of ['Business', 'Pro', 'No plan'])
    expect(within(menu).queryByText(new RegExp(text))).not.toBeInTheDocument()
})
