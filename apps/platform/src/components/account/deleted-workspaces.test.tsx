import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { DeletedWorkspaces } from './deleted-workspaces'

const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

let deleted = [
  {
    id: 'wdl_1',
    workspace_id: 'wsp_1',
    name: 'Acme AG',
    deleted_at: '2026-11-10T10:00:00Z',
    restore_until: '2026-12-10T10:00:00Z',
  },
]
const restored: string[] = []
const server = setupServer(
  http.get('/api/v1/workspaces/deleted', () => HttpResponse.json({ data: deleted })),
  http.post<{ id: string }>('/api/v1/workspaces/deleted/:id/restore', ({ params }) => {
    restored.push(params.id)
    deleted = []
    return HttpResponse.json({ csrf_token: 'csrf_new' })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

const renderSection = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DeletedWorkspaces />
    </QueryClientProvider>,
  )

test('lists a deleted workspace and restores it into the session', async () => {
  renderSection()
  expect(await screen.findByText('Acme AG')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  expect(restored).toEqual(['wdl_1'])
})

test('shows nothing when no workspace is restorable', async () => {
  deleted = []
  const { container } = renderSection()
  await waitFor(() => expect(server.listHandlers().length).toBeGreaterThan(0))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(container).toBeEmptyDOMElement()
})
