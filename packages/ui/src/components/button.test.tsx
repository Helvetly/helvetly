import { render, screen } from '@testing-library/react'

import { Button } from './button'

test('renders the requested variant', () => {
  render(<Button variant="outline">Save</Button>)
  expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-variant', 'outline')
})

test('a disabled primary button keeps readable text instead of fading', () => {
  render(<Button disabled>Save</Button>)
  const button = screen.getByRole('button', { name: 'Save' })
  expect(button).toBeDisabled()
  expect(button.className).toContain('disabled:text-muted-foreground')
  expect(button.className).toContain('disabled:opacity-100')
})

test('a destructive outline button is red-edged on the card, not a solid red block', () => {
  render(<Button variant="destructive-outline">Delete workspace</Button>)
  const button = screen.getByRole('button', { name: 'Delete workspace' })
  expect(button).toHaveAttribute('data-variant', 'destructive-outline')
  expect(button.className).toContain('border-destructive/40')
  expect(button.className).toContain('text-destructive')
  expect(button.className).not.toContain('bg-destructive ')
})
