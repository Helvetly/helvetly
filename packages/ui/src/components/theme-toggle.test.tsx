import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ThemeProvider } from './theme-provider'
import { ThemeToggle } from './theme-toggle'

afterEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
})

function renderToggle(inMenu?: boolean) {
  render(
    <ThemeProvider hotkey={false}>
      <ThemeToggle inMenu={inMenu} />
    </ThemeProvider>,
  )
}

test('shows System as the current theme until one is chosen', () => {
  renderToggle()
  expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false')
})

test('switching sets, marks and stores the theme', async () => {
  const user = userEvent.setup()
  renderToggle()

  await user.click(screen.getByRole('radio', { name: 'Dark' }))
  expect(document.documentElement).toHaveClass('dark')
  expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  expect(localStorage.getItem('theme')).toBe('dark')

  await user.click(screen.getByRole('radio', { name: 'Light' }))
  expect(document.documentElement).toHaveClass('light')
  expect(document.documentElement).not.toHaveClass('dark')
  expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'false')
})

test('names each icon in a tooltip', async () => {
  const user = userEvent.setup()
  renderToggle()
  await user.hover(screen.getByRole('radio', { name: 'Light' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Light')
})

test('inside a menu the buttons are its radio items', () => {
  renderToggle(true)
  expect(
    screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label')),
  ).toEqual(['Light', 'Dark', 'System'])
})
