import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DropdownMenu, DropdownMenuContent } from './dropdown-menu'
import { Flag } from './flag'
import { LanguageDialogButton, LanguageSubmenu, LanguageSwitcher } from './language-switcher'

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

test('the footer language button opens a dialog with every language, the current one marked', async () => {
  const user = userEvent.setup()
  render(<LanguageDialogButton />)

  await user.click(screen.getByRole('button', { name: /^Change language.*English/ }))

  const dialog = screen.getByRole('dialog', { name: 'Change language' })
  for (const name of ['Deutsch', 'English', 'Français', 'Italiano'])
    expect(within(dialog).getByRole('button', { name })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'English' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the account-menu language row shows the current language and opens every language', async () => {
  const user = userEvent.setup()
  render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <LanguageSubmenu />
      </DropdownMenuContent>
    </DropdownMenu>,
  )

  const row = screen.getByRole('menuitem', { name: /^Language/ })
  expect(row).toHaveTextContent('English')
  await user.click(row)
  const sub = await screen.findAllByRole('menuitemradio')
  expect(sub.map((item) => item.textContent)).toEqual(
    expect.arrayContaining(['Deutsch', 'English', 'Français', 'Italiano']),
  )
  expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})
