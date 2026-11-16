import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { getCsrfToken, setCsrfToken } from '@/lib/api'

import { SignIn } from './sign-in'

const { replace } = vi.hoisted(() => ({ replace: vi.fn<(path: string) => void>() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

const challenge = 'abcdefghijklmnopqrstuvwxyz'
const verify = vi.fn<(value: unknown) => void>()
const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in.' } }, { status: 401 }),
  ),
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: true, email: true, passkey: false, dev_codes: false }),
  ),
  http.post('/api/v1/auth/email/start', () =>
    HttpResponse.json({ expires_in: 600, resend_in: 0 }, { status: 202 }),
  ),
  http.post('/api/v1/auth/email/verify', () =>
    HttpResponse.json({ two_factor_required: true, challenge_id: challenge }),
  ),
  http.post('/api/v1/auth/two-factor/verify', async ({ request }) => {
    verify(await request.json())
    return HttpResponse.json({ csrf_token: 'verified-factor', next: '/clients' }, { status: 201 })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  replace.mockClear()
  verify.mockClear()
  setCsrfToken('')
  window.history.replaceState(null, '', '/login?next=/clients')
})
afterEach(() => server.resetHandlers())

function renderSignIn() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SignIn />
    </QueryClientProvider>,
  )
}

test('email first factor waits for a real second step before navigating or storing CSRF', async () => {
  renderSignIn()
  await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), 'alice@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }), '123456')
  await screen.findByRole('heading', { name: 'Two-factor authentication' })
  expect(replace).not.toHaveBeenCalled()
  expect(getCsrfToken()).toBe('')
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Authenticator or recovery code' }),
    'abcde-fghij',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/clients'))
  expect(verify).toHaveBeenCalledWith({ challenge_id: challenge, code: 'abcde-fghij' })
  expect(getCsrfToken()).toBe('verified-factor')
})

test('Google callback reads its second-factor challenge from the fragment and removes it from the URL', async () => {
  window.history.replaceState(null, '', '/login?two_factor=1#challenge=' + challenge)
  renderSignIn()
  await screen.findByRole('heading', { name: 'Two-factor authentication' })
  expect(window.location.hash).toBe('')
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Authenticator or recovery code' }),
    '123456',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
  await waitFor(() =>
    expect(verify).toHaveBeenCalledWith({ challenge_id: challenge, code: '123456' }),
  )
})

test('an invalid Google fragment is removed without opening a second-factor challenge', async () => {
  window.history.replaceState(null, '', '/login?two_factor=1#challenge=invalid')
  renderSignIn()
  await screen.findByRole('textbox', { name: 'Email' })
  expect(screen.queryByRole('heading', { name: 'Two-factor authentication' })).toBeNull()
  expect(window.location.hash).toBe('')
})

test('someone already signed in is sent on to where they were going, without the form', async () => {
  server.use(
    http.get('/api/v1/session', () =>
      HttpResponse.json({
        user: { id: 'u1', email: 'anna@example.com', name: 'Anna', avatar_url: null },
        workspace: { id: 'w1', name: 'Muster GmbH' },
        role: 'owner',
        onboarded: true,
        csrf_token: 'token',
      }),
    ),
  )
  renderSignIn()
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/clients'))
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
})

test('a recent code on the email step opens code entry instead of a dead-end error', async () => {
  server.use(
    http.post('/api/v1/auth/email/start', () =>
      HttpResponse.json(
        {
          error: {
            code: 'code_cooldown',
            message: 'A code was just sent.',
            details: { resend_in: 20, expires_in: 570 },
          },
        },
        { status: 429 },
      ),
    ),
  )
  renderSignIn()
  await userEvent.type(await screen.findByRole('textbox', { name: 'Email' }), 'alice@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Check your email' })
  expect(screen.getByRole('button', { name: /Resend code in/ })).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox', { name: 'Code' }), '123456')
  await screen.findByRole('heading', { name: 'Two-factor authentication' })
})
