import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConfirmDialog } from './confirm-dialog'

const renderDialog = () => {
  const onDecide = vi.fn<(approved: boolean) => void>()
  const view = render(
    <ConfirmDialog
      title="Delete Weber Design?"
      body="This removes the client."
      confirmLabel="Delete client"
      tone="destructive"
      onDecide={onDecide}
    />,
  )
  return { onDecide, view }
}

test('approving sends one decision, even when the dialog closes afterwards', async () => {
  const { onDecide } = renderDialog()

  await userEvent.click(screen.getByRole('button', { name: 'Delete client' }))
  await userEvent.keyboard('{Escape}')

  expect(onDecide.mock.calls).toEqual([[true]])
})

test('closing without approving declines once', async () => {
  const { onDecide } = renderDialog()

  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))

  expect(onDecide.mock.calls).toEqual([[false]])
})
