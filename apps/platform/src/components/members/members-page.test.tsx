import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Invitation, Member } from '@/lib/members'

import { MembersPage } from './members-page'

const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn<() => void>() }),
  usePathname: () => '/members',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const member = (over: Partial<Member>): Member => ({
  user_id: 'usr_x',
  name: 'Name',
  email: 'x@example.ch',
  avatar_url: null,
  role: 'member',
  scopes: ['*:*'],
  joined_at: '2026-01-01T00:00:00Z',
  last_active_at: null,
  is_you: false,
  ...over,
})
const people = [
  member({ user_id: 'usr_1', name: 'Olga Owner', role: 'owner' }),
  member({ user_id: 'usr_2', name: 'Mia Member', role: 'member', scopes: ['read:clients'] }),
  member({ user_id: 'usr_3', name: '<script>x</script>', role: 'member' }),
]
const invitation: Invitation = {
  id: 'inv_1',
  email: 'new@example.ch',
  role: 'member',
  scopes: ['read:*'],
  invited_by: 'Olga Owner',
  created_at: '2026-11-01T00:00:00Z',
  expires_at: '2026-11-08T00:00:00Z',
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.clearAllMocks()
})
afterAll(() => server.close())

function serve(
  role: string,
  list: Member[] = people,
  invitations: Invitation[] = [invitation],
  billing: Record<string, unknown> = {},
) {
  server.use(
    http.get('/api/v1/session', () =>
      HttpResponse.json({
        user: { id: 'usr_9', name: 'Me' },
        workspace: { id: 'ws_1', name: 'Acme', timezone: 'Europe/Zurich' },
        role,
        csrf_token: 't',
      }),
    ),
    http.get('/api/v1/members', () => HttpResponse.json({ data: list })),
    http.get('/api/v1/members/invitations', () => HttpResponse.json({ data: invitations })),
    http.get('/api/v1/billing', () =>
      HttpResponse.json({
        data: {
          enabled: true,
          usage: [{ limit: 'members', used: list.length, max: 3 }],
          plans: [],
          features: ['employees'],
          ...billing,
        },
      }),
    ),
  )
}
const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider>
          <MembersPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

test('a member sees no Invite button and no row menu on others', async () => {
  serve('member')
  renderPage()
  await screen.findByText('Olga Owner')
  expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull()
})

test('an admin gets no menu on an owner row', async () => {
  serve('admin')
  renderPage()
  await screen.findByText('Olga Owner')
  expect(screen.queryByRole('button', { name: 'Actions for Olga Owner' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Actions for Mia Member' })).toBeVisible()
})

test('the invite dialog shows the link after 201 with email_sent false', async () => {
  serve('owner')
  server.use(
    http.post('/api/v1/members/invitations', () =>
      HttpResponse.json(
        { data: { ...invitation, url: 'https://x.ch/invite?token=abc', email_sent: false } },
        { status: 201 },
      ),
    ),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
  await userEvent.type(screen.getByLabelText(/Email/), 'new@example.ch')
  await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
  expect(await screen.findByDisplayValue('https://x.ch/invite?token=abc')).toBeVisible()
  expect(screen.getByText(/didn’t go out/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Copy' })).toBeVisible()
})

test('a sent invitation closes the sheet and keeps its link under Copy link', async () => {
  serve('owner')
  server.use(
    http.post('/api/v1/members/invitations', () =>
      HttpResponse.json(
        { data: { ...invitation, url: 'https://x.ch/invite?token=abc', email_sent: true } },
        { status: 201 },
      ),
    ),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Invite member' }))
  await userEvent.type(screen.getByLabelText(/Email/), 'new@example.ch')
  await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull())
  expect(toast.success).toHaveBeenCalledWith(`Invitation sent to ${invitation.email}.`)
  expect(screen.queryByDisplayValue('https://x.ch/invite?token=abc')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${invitation.email}` }))
  expect(await screen.findByRole('menuitem', { name: 'Copy link' })).toBeVisible()
})

test('removing asks first', async () => {
  serve('owner')
  const removed = vi.fn<() => void>()
  server.use(
    http.delete('/api/v1/members/usr_2', () => {
      removed()
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Mia Member' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
  expect(removed).not.toHaveBeenCalled()
  await userEvent.click(await screen.findByRole('button', { name: 'Remove member' }))
  await waitFor(() => expect(removed).toHaveBeenCalled())
})

test('leaving on your own row goes to /login after 204', async () => {
  serve('member', [member({ user_id: 'usr_9', name: 'Me Myself', is_you: true })])
  server.use(http.delete('/api/v1/members/usr_9', () => new HttpResponse(null, { status: 204 })))
  renderPage()
  expect(await screen.findByText('You')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Me Myself' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Leave workspace/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Leave workspace' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
})

test('a 409 last_owner message is shown as a toast', async () => {
  serve('member', [member({ user_id: 'usr_9', name: 'Me Myself', role: 'owner', is_you: true })])
  server.use(
    http.delete('/api/v1/members/usr_9', () =>
      HttpResponse.json(
        { error: { code: 'last_owner', message: 'A workspace needs an owner.' } },
        { status: 409 },
      ),
    ),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Me Myself' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Leave workspace/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Leave workspace' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A workspace needs an owner.'))
  expect(replace).not.toHaveBeenCalled()
})

test('a name with markup renders as text', async () => {
  serve('member')
  const { container } = renderPage()
  expect(await screen.findByText('<script>x</script>')).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
})

test('shows counts, seats used and the relative last-active date', async () => {
  serve(
    'owner',
    [
      member({ user_id: 'usr_1', name: 'Olga Owner', last_active_at: new Date().toISOString() }),
    ].concat(people.slice(1)),
  )
  renderPage()
  expect(await screen.findByText('3 members · 1 pending invitation')).toBeVisible()
  expect(await screen.findByText('3 of 3 seats used', { exact: false })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
    'href',
    '/settings/billing/plans',
  )
  expect(screen.getByText('just now')).toBeVisible()
})

test('an owner alone is invited to invite', async () => {
  serve('owner', [member({ user_id: 'usr_9', name: 'Me Myself', role: 'owner', is_you: true })], [])
  renderPage()
  expect(await screen.findByText('Work together')).toBeVisible()
  expect(screen.getAllByRole('button', { name: 'Invite member' })).toHaveLength(2)
})

test('the invite panel is hidden once there are more people', async () => {
  serve('owner')
  renderPage()
  await screen.findByText('Olga Owner')
  expect(screen.queryByText('Work together')).toBeNull()
})

test('shows each access as a badge, invitations included', async () => {
  serve('owner')
  renderPage()
  await screen.findByText('Olga Owner')
  expect(screen.getByText('Custom')).toBeVisible()
  expect(screen.getByText('Read only')).toBeVisible()
  expect(screen.getAllByText('Full access').length).toBeGreaterThan(0)
})

test('Change access sends the new scopes in a PATCH', async () => {
  serve('owner')
  const sent = vi.fn<(body: unknown) => void>()
  server.use(
    http.patch('/api/v1/members/usr_2', async ({ request }) => {
      sent(await request.json())
      return HttpResponse.json({ data: people[1] })
    }),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Mia Member' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Change access/ }))
  await userEvent.click(screen.getByRole('radio', { name: 'Read only' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save access' }))
  await waitFor(() => expect(sent).toHaveBeenCalledWith({ scopes: ['read:*'] }))
})

test("an owner changes an admin's HR access, the only part an admin's access has", async () => {
  serve('owner', [
    people[0]!,
    member({ user_id: 'usr_4', name: 'Ann Admin', role: 'admin', scopes: null }),
  ])
  const sent = vi.fn<(body: unknown) => void>()
  server.use(
    http.patch('/api/v1/members/usr_4', async ({ request }) => {
      sent(await request.json())
      return HttpResponse.json({ data: people[1] })
    }),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Ann Admin' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Change access/ }))
  expect(screen.queryByRole('group', { name: 'Access' })).toBeNull()
  expect(screen.getByRole('radio', { name: 'Payroll: View' })).toBeChecked()
  await userEvent.click(screen.getByRole('radio', { name: 'Payroll: No access' }))
  // No HR access at all is a valid choice for an admin.
  await userEvent.click(screen.getByRole('button', { name: 'Save access' }))
  await waitFor(() => expect(sent).toHaveBeenCalledWith({ scopes: [] }))
})

test('an admin cannot change the access of an admin', async () => {
  serve('admin', [member({ user_id: 'usr_4', name: 'Ann Admin', role: 'admin', scopes: null })])
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Ann Admin' }))
  expect(screen.queryByRole('menuitem', { name: /Change access/ })).toBeNull()
})

test('removing on a per-seat plan shows the saving; on a flat plan it does not', async () => {
  const seat = billingFixture({ plan: 'basic', interval: 'month', pricing: 'per_seat' })
  serve('owner', people, [invitation], seat)
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Mia Member' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
  expect(
    await screen.findByText(/Saves CHF 19 \/ month incl\. VAT, prorated by Stripe\./),
  ).toBeVisible()
})

test('leaving on a per-seat plan shows the saving', async () => {
  const seat = billingFixture({ plan: 'pro', interval: 'year', pricing: 'per_seat' })
  serve('member', [member({ user_id: 'usr_9', name: 'Me Myself', is_you: true })], [], seat)
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Me Myself' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Leave workspace/ }))
  expect(await screen.findByText(/Saves CHF 471 \/ year incl\. VAT/)).toBeVisible()
})

test('a flat plan shows no saving when removing', async () => {
  const flat = billingFixture({ plan: 'basic', interval: 'month', pricing: 'flat' })
  serve('owner', people, [invitation], flat)
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Mia Member' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
  expect(await screen.findByText('They lose access to this workspace right away.')).toBeVisible()
})
