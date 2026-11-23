import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupServer } from 'msw/node'

import { queryKeys } from '@/lib/queries'
import { handlers } from '@/mocks/handlers'

import { SelfBillingAgreements } from './self-billing-agreements'

vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

function wrap(role: string, clientId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, { role })
  render(
    <QueryClientProvider client={client}>
      <SelfBillingAgreements clientId={clientId} />
    </QueryClientProvider>,
  )
}

describe('SelfBillingAgreements', () => {
  it('explains self-billing behind the (?) and links the help article', async () => {
    wrap('member', 'cli_sba_test')
    await userEvent.click(screen.getByRole('button', { name: 'About self-billing' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('What is a self-billing agreement?')
    expect(dialog.textContent).toContain('The supplier must agree beforehand')
    expect(screen.getByRole('link', { name: 'Learn more' }).getAttribute('href')).toMatch(
      /\/help\/invoice-document-types$/,
    )
  })

  it('adds an agreement and deletes it before use', async () => {
    wrap('owner', 'cli_sba_test')
    expect(await screen.findByText(/Marco Bernasconi/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /add agreement/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Save agreement' }))
    expect(screen.getByText('Enter the start date.')).toBeTruthy()

    await userEvent.type(screen.getByLabelText(/^Starts on\*?$/), '2027-01-01')
    await userEvent.type(screen.getByLabelText('Accepted by'), 'Eva Keller')
    await userEvent.click(screen.getByRole('button', { name: 'Save agreement' }))
    expect(await screen.findByText(/Eva Keller/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Delete agreement from 1 Jan 2027' }))
    await waitFor(() => expect(screen.queryByText(/Eva Keller/)).toBeNull())
  })

  it('lets a member read only', async () => {
    wrap('member', 'cli_sba_member')
    expect(await screen.findByText(/Marco Bernasconi/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add agreement/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete agreement/i })).toBeNull()
  })
})
