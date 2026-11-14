import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiError } from '@/lib/api'

import { promptUpgrade, UpgradePrompt } from './upgrade-prompt'

test('a limit error opens the prompt with the meter and the way to the plans', async () => {
  render(<UpgradePrompt />)
  expect(promptUpgrade(new ApiError(409, 'conflict', 'Taken.'))).toBe(false)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  act(() => {
    promptUpgrade(
      new ApiError(402, 'limit_reached', 'The Basic plan includes 250 clients.', {
        limit: 'clients',
        used: 250,
        max: 250,
        plan: 'basic',
      }),
    )
  })
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('Client limit reached')
  expect(dialog).toHaveTextContent('The Basic plan includes 250 clients.')
  expect(dialog).toHaveTextContent('250 of 250')
  expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
    'href',
    '/settings/billing/plans',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
