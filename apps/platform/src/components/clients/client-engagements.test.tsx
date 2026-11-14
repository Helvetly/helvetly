import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ClientEngagements } from './client-engagements'

const list = vi.hoisted(() => vi.fn<(query: unknown) => Promise<unknown>>())
const form = vi.hoisted(() => vi.fn<(props: unknown) => void>())
vi.mock('@/lib/engagements', () => ({ listEngagements: list, periodLabel: () => 'Nov 2026' }))
vi.mock('@/components/engagements/engagement-bits', () => ({ ProgressBar: () => <i>bar</i> }))
vi.mock('@/components/engagements/engagement-detail', () => ({ EngagementDetail: () => null }))
vi.mock('@/components/engagements/engagement-form', () => ({
  EngagementForm: (p: { open: boolean; clientId?: string }) => {
    form(p)
    return null
  },
}))

describe('ClientEngagements', () => {
  it('lists the client engagements and prefills the client on New engagement', async () => {
    list.mockResolvedValue({
      data: [
        { id: 'eng_1', title: 'German lessons', unit: 'hour', current_period: { id: 'epr_1' } },
      ],
      meta: {},
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ClientEngagements clientId="cli_1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('German lessons')).toBeTruthy()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cli_1' }))
    await userEvent.click(screen.getByRole('button', { name: /new engagement/i }))
    expect(form).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, clientId: 'cli_1' }),
    )
  })
})
