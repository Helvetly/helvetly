import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { HeidiConsent } from '@/lib/heidi'
import { queryKeys } from '@/lib/queries'

import { AIApprovalProvider, useAIApproval } from './ai-approval'

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

/** The server's own approval for the signed-in person; puts counts what the modal sent. */
function api(state: { consent: HeidiConsent; available?: boolean }) {
  const puts: unknown[] = []
  server.use(
    http.get('/api/v1/heidi/usage', () =>
      HttpResponse.json({
        ...empty,
        provider_available: state.available ?? true,
        consent: state.consent,
      }),
    ),
    http.put('/api/v1/heidi/consent', async ({ request }) => {
      puts.push(await request.json())
      state.consent = { granted: true, changed_at: '2026-11-16T10:00:00Z', changed_by: 'Anna' }
      return HttpResponse.json({ data: state.consent })
    }),
  )
  return puts
}

const notYet: HeidiConsent = { granted: false, changed_at: null, changed_by: '' }

/** Renders the provider with a button that runs one AI action through ensure() and records each answer. */
function setup(workspace = 'ws_a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.session, {
    role: 'member',
    user: { id: 'usr_a' },
    workspace: { id: workspace },
  })
  const answers: boolean[] = []
  function Action() {
    const { ensure } = useAIApproval()
    return <button onClick={() => void ensure().then((ok) => answers.push(ok))}>Ask Heidi</button>
  }
  render(
    <QueryClientProvider client={client}>
      <AIApprovalProvider>
        <Action />
      </AIApprovalProvider>
    </QueryClientProvider>,
  )
  return {
    client,
    answers,
    act: () => userEvent.click(screen.getByRole('button', { name: 'Ask Heidi' })),
  }
}

test('a person who approved before is never asked', async () => {
  const puts = api({
    consent: { granted: true, changed_at: '2026-11-01T00:00:00Z', changed_by: 'Anna' },
  })
  const { answers, act: run } = setup()
  await run()
  await waitFor(() => expect(answers).toEqual([true]))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(puts).toEqual([])
})

test('without a model on the server nothing asks; the server answers locally', async () => {
  api({ consent: notYet, available: false })
  const { answers, act: run } = setup()
  await run()
  await waitFor(() => expect(answers).toEqual([true]))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test.each([
  ['Not now', () => userEvent.click(screen.getByRole('button', { name: 'Not now' }))],
  ['Escape', () => userEvent.keyboard('{Escape}')],
])('%s sends nothing and the action does not run', async (_, decline) => {
  const puts = api({ consent: notYet })
  const { answers, act: run } = setup()
  await run()
  expect(await screen.findByRole('dialog', { name: 'Use AI in this workspace?' })).toBeVisible()
  await decline()
  await waitFor(() => expect(answers).toEqual([false]))
  expect(puts).toEqual([])
})

test('approving writes only the own approval, runs the action once, and is not asked again', async () => {
  const puts = api({ consent: notYet })
  const { answers, act: run } = setup()
  await run()
  await screen.findByRole('dialog')
  // A second action while asking does not run behind the dialog (the page is inert, so no pointer).
  fireEvent.click(screen.getByRole('button', { name: 'Ask Heidi', hidden: true }))
  await userEvent.click(screen.getByRole('button', { name: 'Approve and continue' }))
  await waitFor(() => expect(answers.toSorted()).toEqual([false, true]))
  expect(puts).toEqual([{ granted: true }])
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await run()
  await waitFor(() => expect(answers).toHaveLength(3))
  expect(answers[2]).toBe(true)
  expect(puts).toHaveLength(1)
})

test('switching workspace while asking drops the action', async () => {
  const puts = api({ consent: notYet })
  const { client, answers, act: run } = setup('ws_a')
  await run()
  await screen.findByRole('dialog')
  act(() =>
    client.setQueryData(queryKeys.session, {
      role: 'member',
      user: { id: 'usr_a' },
      workspace: { id: 'ws_b' },
    }),
  )
  await waitFor(() => expect(answers).toEqual([false]))
  expect(puts).toEqual([])
})

test('a second action while the first is still checking does not replace or hang the first', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  server.use(
    http.get('/api/v1/heidi/usage', async () => {
      await gate
      return HttpResponse.json({ ...empty, provider_available: true, consent: notYet })
    }),
  )
  const { answers, act: run } = setup()
  await run()
  await run() // during the first one's fetch
  await waitFor(() => expect(answers).toEqual([false]))
  release()
  expect(await screen.findByRole('dialog')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  await waitFor(() => expect(answers).toEqual([false, false]))
})

test('a late approval from the previous workspace neither answers a newer question nor marks it approved', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  server.use(
    http.get('/api/v1/heidi/usage', () =>
      HttpResponse.json({ ...empty, provider_available: true, consent: notYet }),
    ),
    http.put('/api/v1/heidi/consent', async () => {
      await gate
      return HttpResponse.json({
        data: { granted: true, changed_at: '2026-11-16T10:00:00Z', changed_by: 'Anna' },
      })
    }),
  )
  const { client, answers, act: run } = setup('ws_a')
  await run()
  await userEvent.click(await screen.findByRole('button', { name: 'Approve and continue' }))
  act(() =>
    client.setQueryData(queryKeys.session, {
      role: 'member',
      user: { id: 'usr_a' },
      workspace: { id: 'ws_b' },
    }),
  )
  await waitFor(() => expect(answers).toEqual([false]))
  await run() // asked again in the new workspace
  await screen.findByRole('dialog')
  release()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(answers).toEqual([false])
  expect(screen.getByRole('dialog')).toBeVisible()
})
