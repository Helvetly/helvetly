import { fireEvent, render, screen } from '@testing-library/react'
import type { FormEvent } from 'react'

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

test('the ai variant is an outline-sized button with the gradient edge', () => {
  render(<Button variant="ai">Organize</Button>)
  const button = screen.getByRole('button', { name: 'Organize' })
  expect(button).toHaveAttribute('data-variant', 'ai')
  expect(button.className).toContain('ai-edge')
})

test('a button inside a form does not submit it unless it says type="submit"', () => {
  const submit = vi.fn<(event: FormEvent) => void>((event) => event.preventDefault())
  render(
    <form onSubmit={submit}>
      <Button>Add line</Button>
      <Button type="submit">Save</Button>
    </form>,
  )
  expect(screen.getByRole('button', { name: 'Add line' })).toHaveAttribute('type', 'button')
  fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
  expect(submit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledOnce()
})

test('asChild keeps the child element its own semantics', () => {
  render(
    <Button asChild>
      <a href="https://helvetly.com/">Helvetly</a>
    </Button>,
  )
  expect(screen.getByRole('link', { name: 'Helvetly' })).not.toHaveAttribute('type')
})
