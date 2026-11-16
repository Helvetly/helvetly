import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Flag } from './flag'
import { LanguageSwitcher } from './language-switcher'

test('shows language flags independently of Swiss regional formatting', async () => {
  const user = userEvent.setup()
  render(<LanguageSwitcher />)

  await user.click(screen.getByRole('button', { name: 'Change language' }))

  for (const [name, color] of [
    ['Deutsch', 'fill-flag-german-gold'],
    ['English', 'fill-flag-uk-blue'],
    ['Français', 'fill-flag-french-blue'],
    ['Italiano', 'fill-flag-italian-green'],
  ]) {
    const flag = screen.getByRole('menuitem', { name }).querySelector('svg')
    expect(flag).toHaveAttribute('aria-hidden', 'true')
    expect(flag?.querySelector(`.${color}`)).not.toBeNull()
    expect(flag?.querySelector('.fill-flag-swiss-red')).toBeNull()
  }
})

test('keeps the Swiss country flag for the origin badge', () => {
  const { container } = render(<Flag region="CH" />)

  expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 32 32')
  expect(container.querySelector('.fill-flag-swiss-red')).not.toBeNull()
  expect(container.querySelector('path')).toHaveClass('fill-white')
})

test('omits unsupported country flags', () => {
  const { container } = render(<Flag region="unknown" />)

  expect(container).toBeEmptyDOMElement()
})
