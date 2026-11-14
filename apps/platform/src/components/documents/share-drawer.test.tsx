import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { DocFile } from '@/lib/documents'

import { ShareDrawer } from './share-drawer'

let shares: { client_id: string; client_name: string; shared_at: string }[] = []
let clients = [
  { id: 'cli_1', name: 'Keller AG' },
  { id: 'cli_2', name: 'Meier GmbH' },
]
const posted: unknown[] = []
const deleted: string[] = []

const server = setupServer(
  http.get('/api/v1/documents/doc_1/shares', () => HttpResponse.json({ data: shares })),
  http.get('/api/v1/clients', () => HttpResponse.json({ data: clients })),
  http.post('/api/v1/documents/doc_1/shares', async ({ request }) => {
    const body = {
      client_id: String(
        Object.entries((await request.json()) ?? {}).find(([k]) => k === 'client_id')?.[1],
      ),
    }
    posted.push(body)
    shares = [
      ...shares,
      { client_id: body.client_id, client_name: 'Meier GmbH', shared_at: '2026-11-10T10:00:00Z' },
    ]
    return new HttpResponse(null, { status: 204 })
  }),
  http.delete('/api/v1/documents/doc_1/shares', ({ request }) => {
    const client = new URL(request.url).searchParams.get('client_id')
    deleted.push(String(client))
    shares = shares.filter((share) => share.client_id !== client)
    return new HttpResponse(null, { status: 204 })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  shares = []
  clients = [
    { id: 'cli_1', name: 'Keller AG' },
    { id: 'cli_2', name: 'Meier GmbH' },
  ]
  posted.length = 0
  deleted.length = 0
})
afterAll(() => server.close())

const file = (links: DocFile['links'] = []) =>
  ({ id: 'doc_1', name: 'Contract.pdf', links }) as DocFile

function open(doc: DocFile) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ShareDrawer file={doc} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('ShareDrawer', () => {
  it('preselects the linked client and shares with it', async () => {
    open(file([{ type: 'client', id: 'cli_2', label: 'Meier GmbH', retains: false }]))
    const select = await screen.findByLabelText('Client')
    await waitFor(() => expect(select).toHaveValue('cli_2'))
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(posted).toEqual([{ client_id: 'cli_2' }]))
    expect(await screen.findByRole('button', { name: 'Remove Meier GmbH' })).toBeEnabled()
  })

  it('removes a share', async () => {
    shares = [{ client_id: 'cli_1', client_name: 'Keller AG', shared_at: '2026-11-01T10:00:00Z' }]
    open(file())
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Keller AG' }))
    await waitFor(() => expect(deleted).toEqual(['cli_1']))
    expect(await screen.findByText('Not shared with anyone yet.')).toBeInTheDocument()
  })

  it('disables the picker when there is no client to share with', async () => {
    clients = []
    open(file())
    await screen.findByText('Not shared with anyone yet.')
    expect(screen.getByLabelText('Client')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
  })
})
