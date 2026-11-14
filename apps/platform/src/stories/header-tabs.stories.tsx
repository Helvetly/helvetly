import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Ban, Clock, HandCoins, Layers, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PageHeader } from '@/components/shell/page-header'

import { screenHandlers } from './screen-fixtures'

const TABS = ['All', 'To review', 'Unpaid', 'To reimburse', 'Void']
const ICONS = [Layers, ScanSearch, Clock, HandCoins, Ban]

function Header({ width }: { width: number }) {
  const [active, setActive] = useState(0)
  return (
    <SidebarProvider>
      <div data-testid="frame" className="rounded-xl border" style={{ width }}>
        <PageHeader
          tabs={TABS}
          tabIcons={ICONS}
          tabCounts={[undefined, 3, 1, undefined, undefined]}
          active={active}
          onSelect={setActive}
          savedViews={false}
          primary="New expense"
        />
      </div>
    </SidebarProvider>
  )
}

const meta = {
  title: 'Shell/Header tabs',
  parameters: { msw: { handlers: screenHandlers } },
  render: () => <Header width={420} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const views = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('navigation', { name: 'Views' })
const visibleTabs = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('button')
    .map((tab) => tab.textContent)

/** Tabs that don't fit go under "More" (with their counts summed), never scrolled out of sight. */
export const Overflow: Story = {
  play: async ({ canvasElement }) => {
    const nav = views(canvasElement)
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: /^More views/ })).toBeVisible(),
    )
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth)
    expect(within(nav).getByRole('button', { current: 'page' })).toHaveTextContent('All')

    // The menu lists the hidden tabs with their counts, and is reachable by keyboard.
    within(nav)
      .getByRole('button', { name: /^More views/ })
      .focus()
    await userEvent.keyboard('{Enter}')
    const body = within(document.body)
    const menu = await body.findByRole('menu')
    await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Void' })).toBeVisible())

    // Choosing a hidden tab swaps it in as the active one; the row still fits.
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Void' }))
    await waitFor(() =>
      expect(within(nav).getByRole('button', { current: 'page' })).toHaveTextContent('Void'),
    )
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth)
    await userEvent.click(within(nav).getByRole('button', { name: /^More views/ }))
    const all = await body.findByRole('menuitem', { name: 'All' })
    await waitFor(() => expect(all).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
  },
}

/** Wide enough: every tab shows and there is no "More". */
export const AllFit: Story = {
  render: () => <Header width={1100} />,
  play: async ({ canvasElement }) => {
    const nav = views(canvasElement)
    await waitFor(() => expect(visibleTabs(nav)).toHaveLength(TABS.length))
    expect(within(nav).queryByRole('button', { name: /^More views/ })).toBeNull()
  },
}

/** Narrowing the header moves tabs into "More"; widening brings them back (Heidi opening, a resize). */
export const AdaptsOnResize: Story = {
  render: () => <Header width={1100} />,
  play: async ({ canvasElement }) => {
    const nav = views(canvasElement)
    const frame = within(canvasElement).getByTestId('frame')
    await waitFor(() => expect(visibleTabs(nav)).toHaveLength(TABS.length))
    frame.style.width = '480px'
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: /^More views/ })).toBeVisible(),
    )
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth)
    frame.style.width = '1100px'
    await waitFor(() => expect(visibleTabs(nav)).toHaveLength(TABS.length))
  },
}

/** The "More" menu sizes to its longest label and count, never clipping one (96.png: "Declined"). */
export const MoreMenuFitsItsLabels: Story = {
  render: () => <Header width={300} />,
  play: async ({ canvasElement }) => {
    const nav = views(canvasElement)
    const more = await within(nav).findByRole('button', { name: /^More views/ })
    await userEvent.click(more)
    const menu = await within(document.body).findByRole('menu')
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: /To reimburse/ })).toBeVisible(),
    )
    expect(menu.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      more.getBoundingClientRect().width,
    )
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth)
      for (const label of item.querySelectorAll('span'))
        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
    }
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
  },
}
