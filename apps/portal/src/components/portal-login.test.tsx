import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { PortalLogin } from './portal-login'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn<(to: string) => void>() }),
}))

const server = setupServer(
  http.get('/api/v1/public/portal/session', () =>
    HttpResponse.json({ error: { code: 'unauthenticated', message: 'x' } }, { status: 401 }),
  ),
)
beforeAll(() => server.listen())
afterAll(() => server.close())

test('the sign-in links to the privacy policy on the website', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PortalLogin />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    'https://helvetly.com/privacy',
  )
})
