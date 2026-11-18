import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { ApiError } from '@/lib/api'

import { InlineTagsEditor } from './inline-tags'

const server = setupServer(
  http.get('/api/v1/clients/tags', () =>
    HttpResponse.json({ data: [{ name: 'retainer', count: 4 }] }),
  ),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

function editor(save: (tags: string[]) => Promise<unknown>) {
  const onDone = vi.fn<() => void>()
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InlineTagsEditor initial={['vip', 'sss']} save={save} onDone={onDone} />
      <button type="button">Elsewhere</button>
    </QueryClientProvider>,
  )
  return { input: screen.getByRole('textbox', { name: 'Tags' }), onDone }
}

test('removes and adds tags, then saves on an empty Enter', async () => {
  const save = vi.fn<(tags: string[]) => Promise<void>>(() => Promise.resolve())
  const { input, onDone } = editor(save)
  expect(input).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'Remove sss' }))
  expect(input).toHaveFocus()
  await userEvent.type(input, 'ret')
  await userEvent.click(await screen.findByRole('button', { name: /retainer/ }))
  await userEvent.type(input, 'new{Enter}')
  expect(save).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  expect(save).toHaveBeenCalledExactlyOnceWith(['vip', 'retainer', 'new'])
  expect(onDone).toHaveBeenCalledOnce()
})

test('Backspace removes the last tag; leaving the field saves what was typed too', async () => {
  const save = vi.fn<(tags: string[]) => Promise<void>>(() => Promise.resolve())
  const { input } = editor(save)
  await userEvent.type(input, '{Backspace}late payer')
  await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
  expect(save).toHaveBeenCalledExactlyOnceWith(['vip', 'late-payer'])
})

test('Escape and unchanged tags close without saving', async () => {
  const save = vi.fn<(tags: string[]) => Promise<void>>(() => Promise.resolve())
  const first = editor(save)
  await userEvent.type(first.input, 'x{Escape}')
  expect(first.onDone).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
})

test('a refused save keeps the chips and shows why', async () => {
  const save = vi.fn<(tags: string[]) => Promise<void>>(() =>
    Promise.reject(new ApiError(422, 'validation_failed', 'Use at most 30 characters.')),
  )
  const { input, onDone } = editor(save)
  await userEvent.type(input, '{Backspace}{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('Use at most 30 characters.')
  expect(screen.getByText('vip')).toBeVisible()
  await waitFor(() => expect(input).toHaveFocus())
  expect(onDone).not.toHaveBeenCalled()
})
