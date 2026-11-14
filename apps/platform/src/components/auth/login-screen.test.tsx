import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { LoginScreen } from './login-screen'

const { replace } = vi.hoisted(() => ({ replace: vi.fn<(path: string) => void>() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('next=/clients'),
}))

const server = setupServer(
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: true, email: true, passkey: false, dev_codes: false }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  replace.mockClear()
})

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LoginScreen />
    </QueryClientProvider>,
  )
}

test('someone signed in is sent on without the sign-in screen ever showing', async () => {
  server.use(http.get('/api/v1/session', () => HttpResponse.json({ email: 'a@example.com' })))
  renderScreen()
  expect(screen.queryByText(/Terms of Service/)).toBeNull()
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/clients'))
  expect(screen.queryByText(/Terms of Service/)).toBeNull()
})

test('someone signed out gets the sign-in screen once the check is done', async () => {
  server.use(
    http.get('/api/v1/session', () =>
      HttpResponse.json(
        { error: { code: 'unauthenticated', message: 'Sign in.' } },
        { status: 401 },
      ),
    ),
  )
  renderScreen()
  expect(screen.queryByText(/Terms of Service/)).toBeNull()
  expect(await screen.findByText(/Terms of Service/)).toBeInTheDocument()
  expect(replace).not.toHaveBeenCalled()
})

test('the terms and the privacy policy are links to the website', async () => {
  server.use(
    http.get('/api/v1/session', () =>
      HttpResponse.json({ error: { code: 'unauthenticated', message: 'x' } }, { status: 401 }),
    ),
  )
  renderScreen()
  expect(await screen.findByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
    'href',
    'https://helvetly.com/terms',
  )
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    'https://helvetly.com/privacy',
  )
})
