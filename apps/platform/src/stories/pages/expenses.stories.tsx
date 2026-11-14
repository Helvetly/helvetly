import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ExpensesPage } from '@/components/expenses/expenses-page'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Expenses',
  beforeEach: closeHeidi,
  parameters: pageParameters('/expenses'),
  render: () => (
    <Frame>
      <ExpensesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Swisscom (Schweiz) AG') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

export const Detail: Story = {
  parameters: pageParameters('/expenses', { id: 'exp_1' }),
  play: shows('Zürich–Bern return'),
}
export const DetailDark = dark(Detail)
export const DetailPhone = phone(Detail)

/** On a phone the header keeps the active tab and puts the rest under "More": no tab scrolls away. */
export const HeaderTabsPhone: Story = {
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await shows('Swisscom (Schweiz) AG')?.(context)
    const body = within(document.body)
    const views = body.getByRole('navigation', { name: 'Views' })
    expect(views.scrollWidth).toBeLessThanOrEqual(views.clientWidth)
    expect(within(views).getByRole('button', { current: 'page' })).toHaveTextContent('All')
    await userEvent.click(within(views).getByRole('button', { name: /^More views/ }))
    const hidden = await body.findByRole('menuitem', { name: 'Void' })
    await waitFor(() => expect(hidden).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
  },
}
export const HeaderTabsPhoneDark = dark(HeaderTabsPhone)

/** At desktop width every tab fits: no "More". */
export const HeaderTabsFit: Story = {
  play: async (context) => {
    await shows('Swisscom (Schweiz) AG')?.(context)
    const views = within(document.body).getByRole('navigation', { name: 'Views' })
    for (const tab of ['All', 'To review', 'Unpaid', 'To reimburse', 'Void'])
      expect(within(views).getByRole('button', { name: new RegExp(`^${tab}`) })).toBeVisible()
    expect(within(views).queryByRole('button', { name: /^More views/ })).toBeNull()
  },
}
