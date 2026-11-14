import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { AcceptInvitation } from './accept-invitation'

const replace = vi.fn<(href: string) => void>()
let query = 'token=tok_1'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/invite',
  useSearchParams: () => new URLSearchParams(query),
}))

const preview = (status: string) =>
  http.get('/api/v1/invitations/preview', () =>
    HttpResponse.json({
      data: {
        workspace_name: 'Muster GmbH',
        invited_by: 'Anna Muster',
        email: 'bob@example.com',
        role: 'member',
        status,
      },
    }),
  )

const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({
      user: { id: 'u1', email: 'carl@example.com', name: 'Carl', avatar_url: null },
      workspace: { id: 'w1', name: 'Own' },
      role: 'owner',
      onboarded: true,
      csrf_token: 't',
    }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  replace.mockClear()
  query = 'token=tok_1'
})
afterAll(() => server.close())

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider>
          <AcceptInvitation />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('shows the workspace and inviter, and Accept goes to the dashboard', async () => {
  server.use(
    preview('open'),
    http.post('/api/v1/invitations/accept', () => HttpResponse.json({ csrf_token: 'n' })),
  )
  renderPage()
  expect(
    await screen.findByText('Anna Muster invited you to join Muster GmbH as member'),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
})

test('an email mismatch shows the invited address and offers Sign out', async () => {
  let signedOut = false
  server.use(
    preview('open'),
    http.post('/api/v1/invitations/accept', () =>
      HttpResponse.json(
        {
          error: {
            code: 'invitation_email_mismatch',
            message: 'wrong account',
            details: { email: 'bob@example.com' },
          },
        },
        { status: 403 },
      ),
    ),
    http.delete('/api/v1/session', () => {
      signedOut = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))
  expect(
    await screen.findByText(
      "This invitation is for bob@example.com. You're signed in as carl@example.com.",
    ),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Finvite%3Ftoken%3Dtok_1'))
  expect(signedOut).toBe(true)
})

test('an expired invitation asks for a new one and cannot be accepted', async () => {
  server.use(preview('expired'))
  renderPage()
  expect(
    await screen.findByText('This invitation has expired. Ask Anna Muster for a new one.'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
})

test('a missing token is not valid', async () => {
  query = ''
  renderPage()
  expect(await screen.findByText('This invitation link is not valid')).toBeInTheDocument()
})
