import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bell } from 'lucide-react'
import { useState } from 'react'

import { SwitchRow } from './switch-row'
import { TooltipProvider } from './tooltip'

function Row(props: Partial<React.ComponentProps<typeof SwitchRow>>) {
  const [on, setOn] = useState(false)
  return (
    <TooltipProvider>
      <SwitchRow
        label="Payment reminders"
        description="Overdue invoices get reminders."
        checked={on}
        onCheckedChange={setOn}
        {...props}
      />
    </TooltipProvider>
  )
}

test('names the switch by its title and describes it by its description', () => {
  render(<Row />)
  const toggle = screen.getByRole('switch', { name: 'Payment reminders' })
  expect(toggle).toHaveAccessibleDescription('Overdue invoices get reminders.')
})

test('toggles when any part of the card is clicked', async () => {
  const user = userEvent.setup()
  render(<Row />)
  const toggle = screen.getByRole('switch', { name: 'Payment reminders' })
  const card = toggle.closest('[data-slot=switch-row]')
  const offLook = card?.className
  await user.click(screen.getByText('Overdue invoices get reminders.'))
  expect(toggle).toBeChecked()
  // Only the switch shows the state; the card looks the same on and off.
  expect(card?.className).toBe(offLook)
  await user.click(toggle)
  expect(toggle).not.toBeChecked()
})

test('toggles from the keyboard', async () => {
  const user = userEvent.setup()
  render(<Row />)
  await user.tab()
  const toggle = screen.getByRole('switch', { name: 'Payment reminders' })
  expect(toggle).toHaveFocus()
  await user.keyboard(' ')
  expect(toggle).toBeChecked()
})

test('a disabled row does not toggle', async () => {
  const user = userEvent.setup()
  render(<Row disabled icon={Bell} />)
  const toggle = screen.getByRole('switch', { name: 'Payment reminders' })
  expect(toggle).toBeDisabled()
  await user.click(screen.getByText('Payment reminders'))
  expect(toggle).not.toBeChecked()
})

test('a locked row says why', async () => {
  const user = userEvent.setup()
  render(<Row disabledReason="Only an owner or admin can change this." />)
  const toggle = screen.getByRole('switch', { name: 'Payment reminders' })
  expect(toggle).toBeDisabled()
  expect(toggle).toHaveAccessibleDescription(
    'Overdue invoices get reminders. Only an owner or admin can change this.',
  )
  await user.hover(screen.getByText('Payment reminders'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Only an owner or admin can change this.',
  )
})
