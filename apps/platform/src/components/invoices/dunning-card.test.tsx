import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { sampleInvoice, sampleSchedule } from '@/test/invoice-api'

import { DunningCard, dunnable } from './dunning-card'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const open = sampleInvoice({ id: 'inv_card', number: '2026-014', status: 'open' })

const renderCard = (canManage = true, id = 'inv_card') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DunningCard invoice={{ ...open, id }} canManage={canManage} />
    </QueryClientProvider>,
  )

test('only issued receivable invoices without instalments are dunned', () => {
  expect(dunnable(open)).toBe(true)
  expect(dunnable({ ...open, status: 'draft' })).toBe(false)
  expect(dunnable({ ...open, kind: 'credit_note' })).toBe(false)
  expect(dunnable({ ...open, instalments: sampleSchedule() })).toBe(false)
  expect(dunnable({ ...open, plan: { id: 'pln_1', seq: 1, count: 3 } })).toBe(false)
})

test('sends the next level by hand, lists it with its letter, and pauses', async () => {
  renderCard()
  expect(await screen.findByText('Zahlungserinnerung goes out on 15 Dec 2026.')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Send Zahlungserinnerung now' }))
  const sent = await screen.findByRole('list', { name: 'Reminders sent' })
  const letter = within(sent).getByRole('link', { name: 'Zahlungserinnerung' })
  expect(letter).toHaveAttribute('href', '/api/v1/invoices/inv_card/dunning/1/pdf')
  expect(within(sent).getByText(/by Anna Muster/)).toBeVisible()
  expect(screen.getByText('2. Mahnung goes out on 29 Dec 2026.')).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(await screen.findByText('Paused: no reminder goes out until you resume.')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
  expect(await screen.findByText('2. Mahnung goes out on 29 Dec 2026.')).toBeVisible()
})

test('read-only people see the reminders without the actions', async () => {
  renderCard(false, 'inv_card_ro')
  expect(await screen.findByText(/goes out on/)).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('a refused send keeps the card and says why', async () => {
  server.use(
    http.post('/api/v1/invoices/:id/dunning/send', () =>
      HttpResponse.json(
        { error: { code: 'invalid_state', message: 'The client has no email address.' } },
        { status: 409 },
      ),
    ),
  )
  renderCard(true, 'inv_card_refused')
  await userEvent.click(await screen.findByRole('button', { name: /^Send / }))
  expect(await screen.findByText('Zahlungserinnerung goes out on 15 Dec 2026.')).toBeVisible()
  expect(screen.getByRole('button', { name: /^Send / })).toBeEnabled()
})

test('a failed load says so', async () => {
  server.use(
    http.get('/api/v1/invoices/:id/dunning', () =>
      HttpResponse.json({ error: { code: 'internal', message: 'Down.' } }, { status: 500 }),
    ),
  )
  renderCard(true, 'inv_card_down')
  expect(await screen.findByText(/Couldn’t load the reminders/)).toBeVisible()
})
