import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { HeidiConsent } from '@/lib/heidi'
import { queryKeys } from '@/lib/queries'

import { AIConsentCard } from './ai-consent'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const empty = {
  period: '2026-11',
  tokens_used: 0,
  tokens_included: 0,
  tokens_purchased: 0,
  tokens_remaining: 0,
}
const usage = (body: object) =>
  http.get('/api/v1/heidi/usage', () => HttpResponse.json({ ...empty, ...body }))

function renderCard(role: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, { role })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AIConsentCard />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('an owner turns OpenAI on and sees who changed it', async () => {
  let consent: HeidiConsent = { granted: false, changed_at: null, changed_by: '' }
  const sent: unknown[] = []
  server.use(
    http.get('/api/v1/heidi/usage', () =>
      HttpResponse.json({ ...empty, provider_available: true, consent }),
    ),
    http.put('/api/v1/heidi/consent', async ({ request }) => {
      sent.push(await request.json())
      consent = { granted: true, changed_at: '2026-11-09T10:00:00Z', changed_by: 'Anna' }
      return HttpResponse.json({ data: consent })
    }),
  )
  renderCard('owner')
  expect(await screen.findByText('Off: Heidi answers from your data only')).toBeVisible()
  await userEvent.click(screen.getByRole('switch', { name: 'Allow Heidi to use OpenAI' }))
  await waitFor(() => expect(sent).toEqual([{ granted: true }]))
  expect(await screen.findByText('On since 9 Nov 2026 · by Anna')).toBeVisible()
})

test('a member sees the state but cannot change it', async () => {
  server.use(
    usage({
      provider_available: true,
      consent: { granted: true, changed_at: '2026-11-09T10:00:00Z', changed_by: 'Anna' },
    }),
  )
  renderCard('member')
  expect(await screen.findByText(/What Heidi shares with OpenAI/)).toBeVisible()
  const toggle = await screen.findByRole('switch', { name: 'Allow Heidi to use OpenAI' })
  expect(screen.getByText(/Only an owner or admin can change this/)).toBeVisible()
  expect(toggle).toBeDisabled()
  expect(toggle).toBeChecked()
})

test('without a model on the server there is nothing to consent to', async () => {
  let fetched = false
  server.use(
    http.get('/api/v1/heidi/usage', () => {
      fetched = true
      return HttpResponse.json({ ...empty, provider_available: false })
    }),
  )
  const { container } = renderCard('owner')
  await waitFor(() => expect(fetched).toBe(true))
  expect(container).toBeEmptyDOMElement()
})
