import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { NumberSuggestion as Offer } from '@/lib/invoices'
import { sampleSettings } from '@/test/invoice-api'

import { NumberSuggestion } from './number-suggestion'

const offer: Offer = { format: 'FV/{N}/{YYYY}', year: 2026, last: 8, next: 'FV/9/2026' }
let suggestion: Offer | null = offer
let applied = 0

const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({
      user: { id: 'usr_1', email: 'a@example.com', name: 'A', avatar_url: null },
      workspace: { id: 'wsp_1', name: 'Muster GmbH' },
      role: 'owner',
      onboarded: false,
      csrf_token: 't',
    }),
  ),
  http.get('/api/v1/invoice-settings/number-suggestion', () =>
    HttpResponse.json({ data: suggestion }),
  ),
  http.post('/api/v1/invoice-settings/number-suggestion', () => {
    applied++
    return HttpResponse.json({ data: sampleSettings({ number_format: offer.format }) })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  server.resetHandlers()
  suggestion = offer
  applied = 0
})
afterAll(() => server.close())

const show = (onApplied = vi.fn<(format: string) => void>()) => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NumberSuggestion imported="2 invoices" onApplied={onApplied} />
    </QueryClientProvider>,
  )
  return onApplied
}

test('offers the imported numbering and takes it over', async () => {
  const user = userEvent.setup()
  const onApplied = show()
  expect(
    await screen.findByText('They follow FV/{N}/{YYYY}. Your next invoice would be FV/9/2026.'),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Use this format' }))
  expect(await screen.findByText('New invoices continue at FV/9/2026.')).toBeInTheDocument()
  expect(applied).toBe(1)
  expect(onApplied).toHaveBeenCalledWith('FV/{N}/{YYYY}')
})

test('keeping one’s own format hides the offer and changes nothing', async () => {
  const user = userEvent.setup()
  show()
  await user.click(await screen.findByRole('button', { name: 'Keep my format' }))
  expect(screen.queryByText(/They follow/)).toBeNull()
  expect(applied).toBe(0)
})

test('shows nothing when the imported invoices suggest nothing', async () => {
  suggestion = null
  show()
  await waitFor(() => expect(screen.queryByText(/They follow/)).toBeNull())
  expect(screen.queryByRole('button', { name: 'Use this format' })).toBeNull()
})

test('a refused takeover says why and keeps the offer', async () => {
  server.use(
    http.post('/api/v1/invoice-settings/number-suggestion', () =>
      HttpResponse.json(
        { error: { code: 'no_number_suggestion', message: 'An invoice was issued meanwhile.' } },
        { status: 409 },
      ),
    ),
  )
  const user = userEvent.setup()
  show()
  await user.click(await screen.findByRole('button', { name: 'Use this format' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('An invoice was issued meanwhile.')
  expect(screen.getByRole('button', { name: 'Use this format' })).toBeEnabled()
})
