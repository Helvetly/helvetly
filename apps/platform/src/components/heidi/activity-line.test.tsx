import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ActivityLine, formatDuration } from './activity-line'
import type { ChatMessage } from './use-heidi'

const answer = (change: Partial<ChatMessage>): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  text: '',
  attachments: [],
  actions: [],
  state: 'done',
  ...change,
})

test.each([
  [0, '<1s'],
  [999, '<1s'],
  [1000, '1s'],
  [4400, '4s'],
  [59_400, '59s'],
  [65_000, '1m 5s'],
])('formatDuration(%i) is %s', (ms, text) => {
  expect(formatDuration(ms)).toBe(text)
})

test('while working, shows the current step and a live timer', () => {
  vi.useFakeTimers()
  try {
    const startedAt = Date.now()
    render(
      <ActivityLine
        message={answer({ state: 'streaming', startedAt, status: 'Looking up overdue invoices' })}
      />,
    )
    const step = screen.getByRole('status', { name: 'Heidi is thinking' })
    expect(step).toHaveTextContent('Looking up overdue invoices…')
    // No "0s" while it has only just started.
    expect(screen.queryByText(/\ds$/)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('3s')).toBeInTheDocument()
    // The timer is not announced, only the step.
    expect(step).not.toHaveTextContent('3s')
  } finally {
    vi.useRealTimers()
  }
})

test('a confirmed turn keeps counting from the time already worked', () => {
  vi.useFakeTimers()
  try {
    render(
      <ActivityLine
        message={answer({ state: 'streaming', startedAt: Date.now(), workedMs: 4000, text: 'Ok' })}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Writing the answer…')
    expect(screen.getByText('4s')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('without a step or text yet, Heidi is thinking', () => {
  render(<ActivityLine message={answer({ state: 'streaming', startedAt: Date.now() })} />)
  expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
})

test('a finished turn opens the steps it took', async () => {
  render(
    <ActivityLine
      message={answer({ workedMs: 4200, steps: ['Checking the question', 'Writing the answer'] })}
    />,
  )
  const toggle = screen.getByRole('button', { name: 'Worked for 4s' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument()
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('list', { name: 'Steps' })).toHaveTextContent(
    'Checking the questionWriting the answer',
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('a finished turn without steps is plain text', () => {
  render(<ActivityLine message={answer({ workedMs: 300 })} />)
  expect(screen.getByText('Worked for <1s')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('a turn loaded from history shows nothing', () => {
  const { container } = render(<ActivityLine message={answer({ text: 'Hello' })} />)
  expect(container).toBeEmptyDOMElement()
})
