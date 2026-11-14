import { render, screen } from '@testing-library/react'

import { Composer } from './composer'

const composer = (value: string) => (
  <Composer
    value={value}
    onChange={vi.fn<(value: string) => void>()}
    files={[]}
    onAddFiles={vi.fn<(files: File[]) => void>()}
    onRemoveFile={vi.fn<(file: File) => void>()}
    onSend={vi.fn<() => void>()}
    onStop={vi.fn<() => void>()}
    busy={false}
    placeholder="Ask Heidi…"
  />
)

test('the counter appears from 3600 characters', () => {
  const { rerender } = render(composer('a'.repeat(3599)))
  expect(screen.queryByText(/\/ 4000/)).not.toBeInTheDocument()

  rerender(composer('a'.repeat(3600)))
  expect(screen.getByText('3600 / 4000')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
})

test('a message over 4000 characters cannot be sent', () => {
  render(composer('a'.repeat(4001)))
  expect(screen.getByText('4001 / 4000')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  expect(screen.getByLabelText('Message Heidi')).toHaveAttribute('aria-invalid', 'true')
})
