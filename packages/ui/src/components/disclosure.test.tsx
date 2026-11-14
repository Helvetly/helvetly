import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Disclosure } from './disclosure'

test('shows the label and count, and opens and closes on click', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <Disclosure label="Lines to fill in yourself" count={3} description="Not recorded.">
      <p>Hidden line</p>
    </Disclosure>,
  )
  const details = container.querySelector('details')
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('Not recorded.')).toBeInTheDocument()
  expect(details).not.toHaveAttribute('open')
  await user.click(screen.getByText('Lines to fill in yourself'))
  expect(details).toHaveAttribute('open')
  await user.click(screen.getByText('Lines to fill in yourself'))
  expect(details).not.toHaveAttribute('open')
})

test('starts open when asked and leaves out an absent count', () => {
  const { container } = render(
    <Disclosure label="Question" defaultOpen>
      <p>Answer</p>
    </Disclosure>,
  )
  expect(container.querySelector('details')).toHaveAttribute('open')
  expect(container.querySelector('.rounded-full')).toBeNull()
})
