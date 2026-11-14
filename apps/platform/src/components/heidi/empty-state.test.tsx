import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { queryKeys } from '@/lib/queries'

import { EmptyState } from './empty-state'

const searchParams = { current: new URLSearchParams() }
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams.current }))

const asked: string[] = []
const server = setupServer(
  http.get('/api/v1/heidi/suggestions', ({ request }) => {
    asked.push(new URL(request.url).search)
    return HttpResponse.json({
      data: [{ title: 'Overdue', prompt: 'Which invoices are overdue?' }],
    })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  searchParams.current = new URLSearchParams()
  asked.length = 0
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
afterAll(() => server.close())

function renderWelcome(
  onPick = vi.fn<(prompt: string) => void>(),
  page: 'dashboard' | 'clients' = 'dashboard',
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, { user: { name: 'Piotr K.', email: 'p@example.com' } })
  render(
    <QueryClientProvider client={client}>
      <EmptyState page={page} wide={false} onPick={onPick} />
    </QueryClientProvider>,
  )
  return onPick
}

/** Each letter schedules the next after rendering, so time moves one letter at a time. */
const type = (letters: number) => {
  for (let i = 0; i < letters; i++) act(() => vi.advanceTimersByTime(250))
}

/** The letters typed so far: the visible text, without the laid-out but hidden rest. */
const typedText = (heading: HTMLElement) =>
  [...heading.querySelectorAll('span:not(.invisible)')]
    .filter((span) => span.children.length === 0)
    .map((span) => span.textContent)
    .join('')

test('greets by first name and asks what is on the mind', () => {
  renderWelcome()
  const heading = screen.getByRole('heading', { level: 2 })
  expect(heading).toHaveAccessibleName(
    /^Good (morning|afternoon|evening), Piotr\. What’s on your mind\?$/,
  )
  expect(heading.textContent).toMatch(
    /^Good (morning|afternoon|evening), PiotrWhat’s on your mind\?$/,
  )
})

test('the subtitle is short and never runs past two lines', () => {
  renderWelcome()
  const subtitle = screen.getByText(/^Ask about invoices, clients, expenses and VAT/)
  expect(subtitle).toHaveClass('line-clamp-2')
})

test('the greeting types letter by letter behind a caret that fades at the end', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  renderWelcome()
  const heading = screen.getByRole('heading', { level: 2 })
  const full = heading.textContent ?? ''
  expect(typedText(heading)).toBe('')
  type(4)
  expect(typedText(heading)).toBe('Good')
  expect(heading.querySelector('[data-caret] span')).not.toHaveClass('animate-out')
  // Nothing moves while it types: the whole text is laid out from the start.
  expect(heading.textContent).toBe(full)
  type(full.length)
  expect(typedText(heading)).toBe(full)
  expect(heading.querySelectorAll('[data-caret]')).toHaveLength(1)
  expect(heading.querySelector('[data-caret] span')).toHaveClass('animate-out', 'fade-out')
})

test('reduced motion shows the greeting at once', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
  renderWelcome()
  const heading = screen.getByRole('heading', { level: 2 })
  expect(typedText(heading)).toBe(heading.textContent)
})

test('with a client open, its own questions are asked for', async () => {
  searchParams.current = new URLSearchParams({ id: 'cli_1' })
  renderWelcome(undefined, 'clients')
  await screen.findByRole('button', { name: /Which invoices are overdue/ })
  expect(asked.at(-1)).toBe('?page=clients&client=cli_1')
})

test('the open record is only sent from the clients page', async () => {
  searchParams.current = new URLSearchParams({ id: 'inv_1' })
  renderWelcome()
  await screen.findByRole('button', { name: /Which invoices are overdue/ })
  expect(asked.at(-1)).toBe('?page=dashboard')
})

test('a suggestion asks Heidi', async () => {
  const onPick = renderWelcome()
  await userEvent.click(await screen.findByRole('button', { name: /Which invoices are overdue/ }))
  expect(onPick).toHaveBeenCalledWith('Which invoices are overdue?')
})
