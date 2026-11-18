import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'

import { EngagementLink } from './engagement-link'

afterEach(() => vi.unstubAllGlobals())

type Calls = { method: string; url: string; body: string | null }[]

function stubApi({
  engagements,
  linked = null,
  linkStatus = 201,
}: {
  engagements: { id: string; title: string }[]
  linked?: { id: string; title: string } | null
  linkStatus?: number
}) {
  const calls: Calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : null })
      if (url.endsWith('/engagement')) return Response.json({ data: linked })
      if (url.includes('/engagements?'))
        return Response.json({ data: engagements, meta: { page: 1, total: engagements.length } })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (linkStatus !== 201)
        return Response.json(
          {
            error: {
              code: 'validation_failed',
              message: 'The invoice date is outside every period.',
            },
          },
          { status: linkStatus },
        )
      return Response.json({ data: { invoice_id: 'inv_1', period: {} } }, { status: 201 })
    }),
  )
  return calls
}

function renderLink(props: Partial<Parameters<typeof EngagementLink>[0]> = {}) {
  const onPendingChange = vi.fn<(id: string) => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <EngagementLink
          id="eng"
          clientId="cli_1"
          invoiceId="inv_1"
          pending=""
          onPendingChange={onPendingChange}
          {...props}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return onPendingChange
}

test('without a client the control is off', async () => {
  stubApi({ engagements: [] })
  renderLink({ clientId: '' })
  expect(screen.getByRole('button')).toBeDisabled()
})

test('a client without engagements gets a muted, disabled control', async () => {
  stubApi({ engagements: [] })
  renderLink()
  const field = await screen.findByRole('button', { name: /No active engagements/ })
  expect(field).toBeDisabled()
})

test('picking attaches a saved draft at once', async () => {
  const calls = stubApi({ engagements: [{ id: 'eng_1', title: 'German lessons' }] })
  renderLink()
  await userEvent.click(await screen.findByRole('button'))
  await userEvent.click(await screen.findByText('German lessons'))
  await waitFor(() =>
    expect(
      calls.some((c) => c.method === 'POST' && c.url.endsWith('/engagements/eng_1/invoices')),
    ).toBe(true),
  )
  expect(calls.find((c) => c.method === 'POST')?.body).toBe('{"invoice_id":"inv_1"}')
})

test('before the draft exists the choice waits in the editor', async () => {
  const calls = stubApi({ engagements: [{ id: 'eng_1', title: 'German lessons' }] })
  const onPendingChange = renderLink({ invoiceId: null })
  await userEvent.click(await screen.findByRole('button'))
  await userEvent.click(await screen.findByText('German lessons'))
  expect(onPendingChange).toHaveBeenCalledWith('eng_1')
  expect(calls.some((c) => c.method === 'POST')).toBe(false)
})

test('a refused link is reported', async () => {
  const error = vi.spyOn(toast, 'error')
  stubApi({ engagements: [{ id: 'eng_1', title: 'German lessons' }], linkStatus: 422 })
  renderLink()
  await userEvent.click(await screen.findByRole('button'))
  await userEvent.click(await screen.findByText('German lessons'))
  await waitFor(() => expect(error).toHaveBeenCalled())
})

test('a linked invoice shows its engagement and can be removed', async () => {
  const calls = stubApi({ engagements: [], linked: { id: 'eng_1', title: 'German lessons' } })
  renderLink()
  expect(await screen.findByRole('link', { name: 'German lessons' })).toHaveAttribute(
    'href',
    '/engagements?id=eng_1',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Remove from engagement' }))
  await waitFor(() =>
    expect(
      calls.some(
        (c) => c.method === 'DELETE' && c.url.endsWith('/engagements/eng_1/invoices/inv_1'),
      ),
    ).toBe(true),
  )
})
