import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { HeidiConsent } from '@/lib/heidi'
import { useSwitchWorkspace } from '@/lib/members'
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
  const dialog = await screen.findByRole('dialog', { name: 'Use AI in this workspace?' })
  expect(dialog).toBeVisible()
  // short phones: the dialog stays within the screen and scrolls, so its buttons stay reachable
  expect(dialog).toHaveClass('max-h-[calc(100svh-2rem)]', 'overflow-y-auto')
  await decline()
  await waitFor(() => expect(answers).toEqual([false]))
  // the dialog has no trigger: focus goes back to what asked
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ask Heidi' })).toHaveFocus())
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
  // the page changed under the dialog: focus is not taken back to the old action
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: 'Ask Heidi' })).not.toHaveFocus()
  expect(puts).toEqual([])
})

test('a second action while the first is still checking does not replace or hang the first', async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
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
  const { promise: gate, resolve: release } = Promise.withResolvers<void>()
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

test('switching workspace while the approval check is still loading drops the action; B is asked afresh', async () => {
  const held = Promise.withResolvers<void>()
  let workspace = 'ws_a'
  let checks = 0
  const puts: unknown[] = []
  server.use(
    http.get('/api/v1/heidi/usage', async () => {
      if (++checks === 1) await held.promise // A's check is still loading when the switch happens
      return HttpResponse.json({ ...empty, provider_available: true, consent: notYet })
    }),
    http.get('/api/v1/session', () =>
      HttpResponse.json({
        role: 'member',
        user: { id: 'usr_a' },
        workspace: { id: workspace, timezone: 'Europe/Zurich' },
        csrf_token: 'csrf',
      }),
    ),
    http.post('/api/v1/session/workspace', () => {
      workspace = 'ws_b'
      return HttpResponse.json({ csrf_token: 'csrf_b' })
    }),
    http.put('/api/v1/heidi/consent', async ({ request }) => {
      puts.push(await request.json())
      return HttpResponse.json({ data: notYet })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.session, {
    role: 'member',
    user: { id: 'usr_a' },
    workspace: { id: 'ws_a', timezone: 'Europe/Zurich' },
  })
  const answers: boolean[] = []
  function Actions() {
    const { ensure } = useAIApproval()
    const switchTo = useSwitchWorkspace()
    return (
      <>
        <button onClick={() => void ensure().then((ok) => answers.push(ok))}>Ask Heidi</button>
        <button onClick={() => switchTo.mutate('ws_b')}>Switch</button>
      </>
    )
  }
  render(
    <QueryClientProvider client={client}>
      <AIApprovalProvider>
        <Actions />
      </AIApprovalProvider>
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Ask Heidi' }))
  await waitFor(() => expect(checks).toBe(1))
  await userEvent.click(screen.getByRole('button', { name: 'Switch' })) // the real switch: new session, every query reset
  await waitFor(() => expect(answers).toEqual([false]))
  held.resolve() // A's late answer changes nothing
  await waitFor(() =>
    expect(
      client.getQueryData<{ workspace: { id: string } }>(queryKeys.session)?.workspace.id,
    ).toBe('ws_b'),
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(puts).toEqual([])

  await userEvent.click(screen.getByRole('button', { name: 'Ask Heidi' })) // B has not approved: asked afresh
  expect(await screen.findByRole('dialog', { name: 'Use AI in this workspace?' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  await waitFor(() => expect(answers).toEqual([false, false]))
  expect(puts).toEqual([])
})
