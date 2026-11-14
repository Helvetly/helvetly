import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { sampleClient } from '@/test/invoice-fixtures'

import { ChangeRequestBanner, changeRows } from './change-request-banner'

afterEach(() => vi.unstubAllGlobals())

const client = sampleClient({ id: 'k1', city: 'Zurich' })
const pending = {
  id: 'r1',
  fields: { name: 'Alpenglow AG', city: 'Bern' },
  current: { name: 'Alpenglow Studio GmbH', city: 'Zurich' },
  contact: { id: 'c1', name: 'Anna' },
  created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
}

function Harness({ canDecide }: { canDecide: boolean }) {
  const [reviewing, setReviewing] = useState(false)
  return (
    <ChangeRequestBanner
      client={client}
      canDecide={canDecide}
      reviewing={reviewing}
      onReviewingChange={setReviewing}
    />
  )
}

function setup(canDecide: boolean, status = 200) {
  let open = status === 200
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url, init) => {
      if (!init?.method || init.method === 'GET')
        return Response.json({ data: open ? pending : null })
      open = false
      return url.endsWith('/approve')
        ? Response.json({ data: client })
        : new Response(null, { status: 204 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness canDecide={canDecide} />
    </QueryClientProvider>,
  )
  return fetchMock
}

/** The JSON body of the POST to the URL ending in suffix, or undefined when there was none. */
const posted = (fetchMock: ReturnType<typeof setup>, suffix: string): unknown => {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => init?.method === 'POST' && url.endsWith(suffix),
  )
  return call && JSON.parse(String(call[1]?.body))
}

async function openReview() {
  const notice = await screen.findByRole('region', { name: 'Change request' })
  await userEvent.click(within(notice).getByRole('button', { name: 'Review' }))
  return within(
    await screen.findByRole('dialog', { name: 'Profile change requested by the client' }),
  )
}

test('an address change is one row with the whole block before and after', () => {
  expect(changeRows(client, pending)).toEqual([
    { key: 'name', label: 'Name', current: ['Alpenglow Studio GmbH'], requested: ['Alpenglow AG'] },
    {
      key: 'address',
      label: 'Address',
      current: ['Seefeldstrasse 88', '8008 Zurich', 'Switzerland'],
      requested: ['Seefeldstrasse 88', '8008 Bern', 'Switzerland'],
    },
  ])
})

test('the drawer shows a one-line notice; the full request opens in the review drawer', async () => {
  setup(true)
  const notice = await screen.findByRole('region', { name: 'Change request' })
  expect(notice.textContent).toContain('Anna asked to change 2 fields')
  expect(notice.textContent).toContain('2 hours ago')
  expect(within(notice).queryByText('Alpenglow AG')).toBeNull()
  const drawer = await openReview()
  expect(drawer.getByText(/Anna via client portal/).textContent).toContain('2 hours ago')
  expect(drawer.getByText('Alpenglow AG')).toBeTruthy()
})

test('approve sends only the checked changes and closes the review', async () => {
  const fetchMock = setup(true)
  const drawer = await openReview()
  await userEvent.click(drawer.getByRole('checkbox', { name: 'Apply address' }))
  await userEvent.click(drawer.getByRole('button', { name: 'Approve 1 change' }))
  expect(await screen.findByText('Changes applied')).toBeTruthy()
  expect(screen.getByText(/other changes were discarded/)).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(posted(fetchMock, '/approve')).toEqual({ fields: ['name'] })
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('status')).toBeNull()
})

test('approve is disabled with nothing checked', async () => {
  setup(true)
  const drawer = await openReview()
  await userEvent.click(drawer.getByRole('checkbox', { name: 'Apply name' }))
  await userEvent.click(drawer.getByRole('checkbox', { name: 'Apply address' }))
  expect(drawer.getByRole('button', { name: 'Approve 0 changes' })).toHaveProperty('disabled', true)
})

test('reject asks first, takes an optional reason, then calls the API', async () => {
  const fetchMock = setup(true)
  const drawer = await openReview()
  await userEvent.click(drawer.getByRole('button', { name: 'Reject' }))
  expect(posted(fetchMock, '/reject')).toBeUndefined()
  const confirm = within(
    await screen.findByRole('dialog', { name: 'Reject the requested changes?' }),
  )
  await userEvent.type(confirm.getByLabelText('Reason for the client (optional)'), ' Wrong VAT ')
  await userEvent.click(confirm.getByRole('button', { name: 'Reject' }))
  expect(await screen.findByText('Request rejected')).toBeTruthy()
  expect(posted(fetchMock, '/reject')).toEqual({ reason: 'Wrong VAT' })
  expect(screen.queryByRole('region', { name: 'Change request' })).toBeNull()
})

test('a member sees the request but no decision controls', async () => {
  setup(false)
  const drawer = await openReview()
  expect(drawer.queryByRole('button', { name: /Approve/ })).toBeNull()
  expect(drawer.queryByRole('checkbox')).toBeNull()
  expect(drawer.getByText(/owner or admin can approve/)).toBeTruthy()
})

test('renders nothing without a pending request', async () => {
  const fetchMock = setup(true, 0)
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(screen.queryByRole('region')).toBeNull()
})
