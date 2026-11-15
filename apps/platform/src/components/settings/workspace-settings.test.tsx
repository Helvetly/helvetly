import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { queryKeys } from '@/lib/queries'
import type { WorkspaceUpdate } from '@/lib/workspaces'

import { GeneralCard, timeZoneOptions, zoneCity } from './workspace-settings'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<() => void>(), replace: vi.fn<() => void>() }),
}))

let sent: WorkspaceUpdate[] = []
let refuse = false
const server = setupServer(
  http.patch('/api/v1/workspace', async ({ request }) => {
    const body = (await request.json()) as WorkspaceUpdate
    sent.push(body)
    if (refuse)
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check',
            details: { fields: { timezone: 'invalid' } },
          },
        },
        { status: 422 },
      )
    return HttpResponse.json({ data: { id: 'wsp_1', name: 'Acme', timezone: 'UTC', ...body } })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  sent = []
  refuse = false
})
afterAll(() => server.close())

function wrap(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <GeneralCard name="Acme" timezone="Europe/Zurich" membershipRole={role} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return invalidate
}

async function chooseZone(zone: string) {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText(/^Time zone\*?$/))
  // One paste of the city, not ~16 keystrokes over ~400 zones: typing timed out on slow CI runners.
  await user.click(screen.getByPlaceholderText('Search…'))
  await user.paste(zoneCity(zone))
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${zoneCity(zone)}`) }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

test('lists every zone by city with its clock and offset, the usual ones first', () => {
  const options = timeZoneOptions('Europe/Zurich', new Date('2026-11-16T08:52:00Z'))
  expect(options[0]).toEqual({
    value: 'Europe/Zurich',
    label: 'Zurich',
    hint: '09:52 · GMT+1',
    group: 'Suggested',
  })
  expect(options).toContainEqual({
    value: 'America/New_York',
    label: 'New York',
    hint: '03:52 · GMT-5',
    group: 'America',
  })
  expect(options.filter((o) => o.value === 'Europe/Zurich')).toHaveLength(1)
  expect(timeZoneOptions('Etc/GMT+5')[0]?.value).toBe('Etc/GMT+5') // the saved zone is always offered
})

test('names nested zones by city and country', () => {
  expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires (Argentina)')
  expect(zoneCity('Africa/Addis_Ababa')).toBe('Addis Ababa')
})

test('an owner saves a new time zone and the session is fetched again', async () => {
  const invalidate = wrap('owner')
  expect(screen.getByLabelText(/^Time zone\*?$/)).toHaveTextContent('Zurich')
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  await chooseZone('America/New_York')
  await waitFor(() => expect(sent).toEqual([{ timezone: 'America/New_York' }]))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.session }))
})

test('an admin cannot rename but can change the time zone', async () => {
  wrap('admin')
  expect(screen.getByLabelText(/^Workspace name\*?$/)).toBeDisabled()
  await chooseZone('Asia/Tokyo')
  await waitFor(() => expect(sent).toEqual([{ timezone: 'Asia/Tokyo' }]))
})

test('a member only sees the time zone', () => {
  wrap('member')
  expect(screen.getByLabelText(/^Time zone\*?$/)).toHaveValue('Europe/Zurich') // a plain disabled field, no picker
  expect(screen.getByLabelText(/^Time zone\*?$/)).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
})

test('a refused time zone shows under the field', async () => {
  refuse = true
  wrap('owner')
  await chooseZone('Asia/Tokyo')
  expect(await screen.findByText('Choose a time zone from the list.')).toBeInTheDocument()
})
