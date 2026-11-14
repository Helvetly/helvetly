import { render, screen, waitFor } from '@testing-library/react'

import { AuthGate } from './auth-gate'
import { Providers } from './providers'

const router = vi.hoisted(() => ({ replace: vi.fn<(href: string) => void>() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const renderGate = () =>
  render(
    <Providers>
      <AuthGate>{(session) => <p>Hello {session.user.name}</p>}</AuthGate>
    </Providers>,
  )

test('sends a signed-out visitor to /login, coming back to the same page', async () => {
  window.history.replaceState(null, '', '/settings/security')
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({ error: { code: 'unauthenticated', message: 'Sign in.' } }, { status: 401 }),
    ),
  )

  renderGate()

  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fsettings%2Fsecurity'),
  )
  expect(screen.queryByText(/Hello/)).not.toBeInTheDocument()
})

test('renders the signed-in area with the session', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({
        user: { id: 'usr_1', email: 'ana@example.com', name: 'Ana', avatar_url: null },
        workspace: { id: 'wsp_1', name: 'My workspace' },
        role: 'owner',
        csrf_token: 'token',
      }),
    ),
  )

  renderGate()

  expect(await screen.findByText('Hello Ana')).toBeInTheDocument()
})
